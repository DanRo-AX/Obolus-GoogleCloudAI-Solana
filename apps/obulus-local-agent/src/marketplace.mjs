import { createHash, randomUUID } from 'node:crypto'

import { LocalAgentError } from './errors.mjs'
import { jsonRequest, requireSuccess } from './http.mjs'
import { minimalFilters, minimizeQuestion } from './privacy.mjs'
import {
  exactBundleQuote,
  exactDocumentQuote,
  exactOpenCallQuote,
  paymentPlan,
} from './quotes.mjs'
import { forgetLocalState, readState, requireQuery, updateState } from './state.mjs'

export class LocalMarketplace {
  constructor(config, options = {}) {
    this.config = config
    this.fetchImpl = options.fetchImpl || fetch
    this.now = options.now || Date.now
  }

  async search(args) {
    const minimized = minimizeQuestion(args.question, args.privacyMode || 'strict')
    const request = {
      question: minimized.question,
      requestedDocuments: args.requestedDocuments ?? 5,
      budgetKrw: args.budgetKrw,
      filters: minimalFilters(args.filters),
    }
    const result = await this.#api('/api/v1/questions/resolve', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
    })
    if (
      typeof result?.queryId !== 'string' ||
      typeof result?.paymentAccessToken !== 'string' ||
      !Array.isArray(result.matches)
    ) {
      throw new LocalAgentError('Search returned an invalid capability.', 'invalid_search_response', 502)
    }
    const handles = result.matches.map((match) => match?.handle)
    if (handles.some((handle) => typeof handle !== 'string' || !handle)) {
      throw new LocalAgentError('Search returned invalid document handles.', 'invalid_search_response', 502)
    }
    await updateState(this.config, (state) => {
      state.queries[result.queryId] = {
        paymentAccessToken: result.paymentAccessToken,
        handles,
        pricesKrw: Object.fromEntries(
          result.matches.map((match) => [match.handle, match.priceKrw]),
        ),
        budgetKrw: request.budgetKrw ?? null,
        maxUnitPriceKrw: request.filters?.maxUnitPriceKrw ?? null,
        createdAt: this.now(),
        questionHash: sha256(minimized.question),
      }
      return state
    })
    const safe = safeSearchResult(result)
    return {
      ...safe,
      privacy: {
        mode: args.privacyMode || 'strict',
        redactions: minimized.redactions,
        sentFields: ['question', 'requestedDocuments', 'budgetKrw', 'filters'],
        accountAttached: false,
      },
      nextAction:
        result.decision === 'hit'
          ? 'Choose the smallest relevant evidence set, then prepare its exact payment.'
          : 'Human coverage is incomplete. A free AI baseline may orient the user, but it is not human evidence.',
    }
  }

  async baseline(args) {
    const state = await readState(this.config)
    const query = requireQuery(state, args.queryId, this.now())
    return this.#api(`/api/v1/questions/${encodeURIComponent(args.queryId)}/ai-baseline`, {
      method: 'POST',
      headers: { 'x-openshelf-query-token': query.paymentAccessToken },
    })
  }

  async preparePayment(args) {
    if (!this.config.payAccount) {
      throw new LocalAgentError(
        'Set OBULUS_PAY_ACCOUNT to a named local Pay.sh account before preparing a payment.',
        'pay_account_required',
        409,
      )
    }
    const state = await readState(this.config)
    const query = requireQuery(state, args.queryId, this.now())
    const handles = [...new Set(args.handles || [])]
    if (handles.length < 1 || handles.length > 100) {
      throw new LocalAgentError('Choose 1-100 document handles.', 'invalid_handles')
    }
    const unknown = handles.filter((handle) => !query.handles.includes(handle))
    if (unknown.length) {
      throw new LocalAgentError(
        `Documents were not quoted for this query: ${unknown.join(', ')}`,
        'invalid_handles',
      )
    }

    let plan
    if (handles.length === 1) {
      const path = `/api/v1/paid-documents/${encodeURIComponent(args.queryId)}/${encodeURIComponent(handles[0])}`
      const result = await this.#gatewayResult(path, { headers: { accept: 'application/json' } })
      if (result.response.status !== 402 || !result.body?.quote) {
        throw new LocalAgentError(
          result.body?.error?.message || `Expected HTTP 402, received ${result.response.status}.`,
          'quote_unavailable',
          result.response.status,
        )
      }
      const canonical = await this.#api(
        `/api/v1/agent-payment-quotes/${encodeURIComponent(args.queryId)}/${encodeURIComponent(handles[0])}`,
        { headers: { 'x-openshelf-query-token': query.paymentAccessToken } },
      )
      const quote = exactDocumentQuote({
        gatewayQuote: result.body.quote,
        canonicalQuote: canonical,
        queryId: args.queryId,
        handle: handles[0],
        resourcePath: path,
        expectedPriceKrw: query.pricesKrw?.[handles[0]],
        budgetKrw: query.budgetKrw,
        maxUnitPriceKrw: query.maxUnitPriceKrw,
        now: this.now(),
      })
      const paymentPath = `/api/v1/paid-quotes/${encodeURIComponent(quote.id)}`
      plan = paymentPlan(
        `${this.config.gatewayOrigin}${paymentPath}`,
        quote,
        `Open human evidence document ${handles[0]}`,
        this.now(),
      )
    } else {
      const prepared = await this.#gateway('/api/v1/payment-bundles', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-openshelf-query-token': query.paymentAccessToken,
          'x-openshelf-agent-payment-mode': 'exact-agent-bundle-v1',
        },
        body: JSON.stringify({ queryId: args.queryId, handles }),
      })
      if (!prepared?.quote?.id) {
        throw new LocalAgentError('Gateway returned an invalid bundle quote.', 'quote_unavailable', 502)
      }
      const canonical = await this.#api(
        `/api/v1/agent-payment-bundles/${encodeURIComponent(prepared.quote.id)}`,
        { headers: { 'x-openshelf-query-token': query.paymentAccessToken } },
      )
      const quote = exactBundleQuote({
        gatewayQuote: prepared.quote,
        canonicalQuote: canonical,
        queryId: args.queryId,
        handles,
        now: this.now(),
      })
      const expectedTotalKrw = handles.reduce((total, handle) => {
        const price = query.pricesKrw?.[handle]
        if (!Number.isSafeInteger(price) || price < 1) {
          throw new LocalAgentError('A selected handle has no canonical search price.', 'unsafe_payment_quote')
        }
        return total + price
      }, 0)
      if (quote.totalPriceKrw !== expectedTotalKrw) {
        throw new LocalAgentError(
          'The bundle total does not match the selected search prices.',
          'unsafe_payment_quote',
        )
      }
      if (Number.isSafeInteger(query.budgetKrw) && quote.totalPriceKrw > query.budgetKrw) {
        throw new LocalAgentError('The bundle exceeds the original query budget.', 'unsafe_payment_quote')
      }
      plan = paymentPlan(
        `${this.config.gatewayOrigin}${quote.resourcePath}`,
        quote,
        `Open ${handles.length} exact human evidence documents`,
        this.now(),
      )
    }

    const intentId = `intent_${randomUUID()}`
    await updateState(this.config, (current) => {
      current.paymentIntents[intentId] = {
        queryId: args.queryId,
        quoteId: plan.quote.id,
        status: 'prepared',
        purpose: plan.purpose,
        paymentUrl: plan.paymentUrl,
        amountAtomic: plan.quote.amountAtomic,
        network: plan.quote.network,
        asset: plan.quote.asset,
        payTo: plan.quote.payTo,
        payAccount: this.config.payAccount,
        expiresAt: plan.quote.expiresAt,
        approvalBinding: plan.approvalBinding,
        paymentUrlHash: sha256(plan.paymentUrl),
        createdAt: this.now(),
      }
      return current
    })
    return {
      status: plan.status,
      purpose: plan.purpose,
      quote: plan.quote,
      intentId,
      signingBoundary: 'Pay.sh local wallet; no Phantom and no Obulus-held private key',
      nextAction: `Ask the user to run npm run local-agent:approve -- ${intentId} in a real terminal. The Pay MCP can execute only this exact one-time approved intent.`,
    }
  }

  async paymentStatus(args) {
    const state = await readState(this.config)
    const query = requireQuery(state, args.queryId, this.now())
    const localIntentEntry = Object.entries(state.paymentIntents).find(
      ([, intent]) => intent.queryId === args.queryId && intent.quoteId === args.jobId,
    )
    const [localIntentId, localIntent] = localIntentEntry || []
    if (localIntent?.approvalBinding?.documentHandle) {
      const recovered = await this.#api(
        `/api/v1/agent-payment-recoveries/${encodeURIComponent(args.jobId)}`,
        { headers: { 'x-openshelf-query-token': query.paymentAccessToken } },
      )
      if (
        recovered?.settlement?.quoteId !== args.jobId ||
        recovered?.citation?.handle !== localIntent.approvalBinding.documentHandle
      ) {
        throw new LocalAgentError('Recovery returned a different document.', 'unsafe_recovery_response', 502)
      }
      await updateState(this.config, (current) => {
        const intent = current.paymentIntents[localIntentId]
        if (['executing', 'ambiguous'].includes(intent?.status)) {
          intent.status = 'completed'
          intent.completedAt = this.now()
          delete intent.approvalNonce
          delete intent.failure
        }
        return current
      })
      return recovered
    }
    const job = await this.#gateway(`/api/v1/research-jobs/${encodeURIComponent(args.jobId)}`, {
      headers: { 'x-openshelf-query-token': query.paymentAccessToken },
    })
    if (job?.queryId !== args.queryId || job?.id !== args.jobId) {
      throw new LocalAgentError('Recovery returned a different job.', 'unsafe_recovery_response', 502)
    }
    return job
  }

  async synthesize(args) {
    const state = await readState(this.config)
    const query = requireQuery(state, args.queryId, this.now())
    const handles = [...new Set(args.handles || [])]
    if (!handles.length || handles.some((handle) => !query.handles.includes(handle))) {
      throw new LocalAgentError('Synthesis handles must come from the local query.', 'invalid_handles')
    }
    return this.#api('/api/v1/answers/synthesize', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-openshelf-query-token': query.paymentAccessToken,
      },
      body: JSON.stringify({ queryId: args.queryId, handles }),
    })
  }

  async callAuthenticatedTool(name, args = {}) {
    switch (name) {
      case 'account_status':
        return this.accountStatus()
      case 'prepare_open_call':
        return this.prepareOpenCall(args)
      case 'open_call_status':
        return this.openCallStatus(args)
      case 'cancel_open_call':
        return this.cancelOpenCall(args)
      case 'submit_document_feedback':
        return this.submitFeedback(args)
      case 'get_profile':
        return this.#authenticatedApi('/api/v1/profile')
      case 'update_profile':
        return this.updateProfile(args)
      case 'prepare_payout_wallet_link':
        return this.preparePayoutWalletLink()
      case 'update_preferences':
        return this.#authenticatedApi('/api/v1/profile/preferences', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(args),
        })
      case 'list_opportunities':
        return this.listOpportunities(args)
      case 'manage_reservation':
        return this.manageReservation(args)
      case 'submit_human_answer':
        return this.submitHumanAnswer(args)
      case 'shelf_starters':
        return this.#authenticatedApi('/api/v1/shelf-starters', {
          method: args.action === 'generate' ? 'POST' : 'GET',
        })
      case 'answer_shelf_starter':
        return this.answerShelfStarter(args)
      case 'notifications':
        return this.notifications(args)
      case 'manage_memory':
        return this.manageMemory(args)
      case 'earnings_and_claims':
        return this.earningsAndClaims()
      case 'account_data':
        return this.accountData(args)
      case 'lookup_contributor':
        return this.#api(`/api/v1/contributors/${encodeURIComponent(args.handle)}`)
      default:
        throw new LocalAgentError(`Unknown tool: ${name}`, 'tool_not_found', 404)
    }
  }

  async accountStatus() {
    const state = await readState(this.config)
    if (!state.sessionToken) {
      return {
        connected: false,
        nextAction: '로컬 터미널에서 Pay.sh 지갑으로 Obulus 계정을 연결하세요.',
      }
    }
    try {
      const response = await this.#authenticatedApi('/api/v1/auth/me', {}, state)
      return { connected: true, ...response }
    } catch (error) {
      if (error.status === 401) await this.clearSession()
      throw error
    }
  }

  async setSession(sessionToken, user = null) {
    if (typeof sessionToken !== 'string' || sessionToken.length < 32) {
      throw new LocalAgentError('서버가 유효한 로컬 세션을 반환하지 않았습니다.', 'invalid_session', 502)
    }
    await updateState(this.config, (state) => {
      state.sessionToken = sessionToken
      state.user = user && typeof user === 'object' ? user : null
      return state
    })
    return { connected: true, user }
  }

  async clearSession() {
    const state = await readState(this.config)
    if (state.sessionToken) {
      await this.#authenticatedApi('/api/v1/auth/logout', { method: 'POST' }, state).catch(
        (error) => {
          if (error.status !== 401) throw error
        },
      )
    }
    await updateState(this.config, (current) => {
      current.sessionToken = null
      current.user = null
      return current
    })
    return { connected: false }
  }

  async prepareOpenCall(args) {
    if (!this.config.payAccount) {
      throw new LocalAgentError('Open Call 결제 전에 로컬 Pay.sh 계정을 선택하세요.', 'pay_account_required', 409)
    }
    const chatId = args.chatId || `chat_${randomUUID()}`
    const request = {
      question: args.question,
      unitPrice: args.unitPriceKrw,
      target: args.target,
      chatId,
      shelf: args.shelf,
      category: args.category,
      filters: args.filters || {},
    }
    const canonical = await this.#authenticatedApi('/api/v1/open-call-funding-quotes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
    })
    const result = await this.#gatewayResult(canonical.resourcePath, {
      headers: { accept: 'application/json' },
    })
    if (result.response.status !== 402 || !result.body?.quote) {
      throw new LocalAgentError(
        result.body?.error?.message || 'Open Call 결제 경계를 확인할 수 없습니다.',
        'quote_unavailable',
        result.response.status,
      )
    }
    const quote = exactOpenCallQuote({
      gatewayQuote: result.body.quote,
      canonicalQuote: canonical,
      unitPriceKrw: args.unitPriceKrw,
      target: args.target,
      now: this.now(),
    })
    const plan = paymentPlan(
      `${this.config.gatewayOrigin}${quote.resourcePath}`,
      quote,
      `${args.target}명의 실제 사람에게 “${args.question}” 질문하기`,
      this.now(),
    )
    const intentId = `intent_${randomUUID()}`
    await updateState(this.config, (state) => {
      state.paymentIntents[intentId] = {
        kind: 'open_call',
        queryId: chatId,
        quoteId: quote.id,
        status: 'prepared',
        purpose: plan.purpose,
        paymentUrl: plan.paymentUrl,
        amountAtomic: quote.amountAtomic,
        network: quote.network,
        asset: quote.asset,
        payTo: quote.payTo,
        payAccount: this.config.payAccount,
        expiresAt: quote.expiresAt,
        approvalBinding: { ...plan.approvalBinding, chatId, target: args.target, unitPriceKrw: args.unitPriceKrw },
        paymentUrlHash: sha256(plan.paymentUrl),
        createdAt: this.now(),
      }
      return state
    })
    return {
      status: 'approval_required',
      intentId,
      chatId,
      quote: plan.quote,
      purpose: plan.purpose,
      signingBoundary: '사용자 확인 후 로컬 Pay.sh만 정확한 에스크로 금액을 서명합니다.',
    }
  }

  async openCallStatus(args) {
    if (!args.quoteId && !args.chatId) {
      throw new LocalAgentError('quoteId 또는 chatId가 필요합니다.', 'invalid_arguments')
    }
    const result = {}
    if (args.quoteId) {
      result.funding = await this.#authenticatedApi(
        `/api/v1/open-call-funding-quotes/${encodeURIComponent(args.quoteId)}`,
      )
    }
    if (args.chatId) {
      result.answers = await this.#authenticatedApi(
        `/api/v1/chats/${encodeURIComponent(args.chatId)}/answers`,
      )
    }
    return result
  }

  async cancelOpenCall(args) {
    if (args.confirmation !== `CANCEL OPEN CALL ${args.openCallId}`) {
      throw new LocalAgentError('공고 취소 확인 문구가 일치하지 않습니다.', 'confirmation_required', 403)
    }
    return this.#authenticatedApi(`/api/v1/open-calls/${encodeURIComponent(args.openCallId)}`, {
      method: 'DELETE',
    })
  }

  async submitFeedback(args) {
    const state = await readState(this.config)
    const query = requireQuery(state, args.queryId, this.now())
    const params = new URLSearchParams({ payer: args.payer })
    return this.#api(
      `/api/v1/questions/${encodeURIComponent(args.queryId)}/paid-documents/${encodeURIComponent(args.handle)}/feedback?${params}`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-openshelf-query-token': query.paymentAccessToken,
        },
        body: JSON.stringify({ outcome: args.outcome, reason: args.reason }),
      },
    )
  }

  async preparePayoutWalletLink() {
    const link = await this.#authenticatedApi('/api/v1/profile/wallet/siwx', { method: 'POST' })
    if (link.network !== 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1') {
      throw new LocalAgentError('Devnet 이외의 지급 지갑 연결을 거부했습니다.', 'unsafe_network')
    }
    return {
      ...link,
      status: 'signature_required',
      nextAction: '이 링크는 지갑 소유권만 증명하며 USDC를 사용하지 않습니다. 로컬 Pay.sh로 서명하세요.',
    }
  }

  async updateProfile(args) {
    const current = await this.#authenticatedApi('/api/v1/profile')
    return this.#authenticatedApi('/api/v1/profile', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // Profile edits must never silently disconnect an already verified payout wallet.
      body: JSON.stringify({ ...args, wallet: current?.wallet || null }),
    })
  }

  async listOpportunities(args) {
    const calls = await this.#authenticatedApi('/api/v1/open-calls')
    return args.eligibleOnly
      ? calls.filter((call) => call.eligible && call.status === 'open' && call.answered < call.target)
      : calls
  }

  async manageReservation(args) {
    const suffix = args.action === 'release' ? '/release' : ''
    return this.#authenticatedApi(
      `/api/v1/open-calls/${encodeURIComponent(args.openCallId)}/reservation${suffix}`,
      { method: 'POST' },
    )
  }

  async submitHumanAnswer(args) {
    requireHumanAuthored(args)
    return this.#authenticatedApi(
      `/api/v1/open-calls/${encodeURIComponent(args.openCallId)}/answers`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          answer: args.answer,
          interviewResponses: args.interviewResponses || [],
        }),
      },
    )
  }

  async answerShelfStarter(args) {
    requireHumanAuthored(args)
    return this.#authenticatedApi(
      `/api/v1/shelf-starters/${encodeURIComponent(args.starterId)}/answer`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ answer: args.answer, priceKrw: args.priceKrw }),
      },
    )
  }

  async notifications(args) {
    if (args.action === 'list') return this.#authenticatedApi('/api/v1/notifications')
    await this.#authenticatedApi('/api/v1/notifications/read', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids: args.ids || [] }),
    })
    return { status: 'marked_read', ids: args.ids || [] }
  }

  async manageMemory(args) {
    if (args.action === 'list') return this.#authenticatedApi('/api/v1/memory')
    if (!args.memoryId) throw new LocalAgentError('memoryId가 필요합니다.', 'invalid_arguments')
    const base = `/api/v1/memory/${encodeURIComponent(args.memoryId)}`
    if (args.action === 'lock') {
      if (typeof args.locked !== 'boolean') {
        throw new LocalAgentError('locked는 true 또는 false여야 합니다.', 'invalid_arguments')
      }
      return this.#authenticatedApi(base, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ locked: args.locked }),
      })
    }
    if (args.action === 'correct') {
      requireHumanAuthored(args)
      if (!args.answer) throw new LocalAgentError('정정 답변이 필요합니다.', 'invalid_arguments')
      return this.#authenticatedApi(`${base}/corrections`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ answer: args.answer }),
      })
    }
    if (!args.reason) throw new LocalAgentError('이의 제기 사유가 필요합니다.', 'invalid_arguments')
    return this.#authenticatedApi(`${base}/dispute`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: args.reason }),
    })
  }

  async earningsAndClaims() {
    const [earnings, payoutClaims] = await Promise.all([
      this.#authenticatedApi('/api/v1/earnings'),
      this.#authenticatedApi('/api/v1/payout-claims'),
    ])
    return { earnings, payoutClaims }
  }

  async accountData(args) {
    if (args.action === 'balance') return this.#authenticatedApi('/api/v1/account/balance')
    if (args.action === 'export') return this.#authenticatedApi('/api/v1/account/export')
    if (args.confirmation !== 'DELETE MY OBULUS ACCOUNT') {
      throw new LocalAgentError('계정 삭제 확인 문구가 일치하지 않습니다.', 'confirmation_required', 403)
    }
    await this.#authenticatedApi('/api/v1/account', { method: 'DELETE' })
    await updateState(this.config, (state) => {
      state.sessionToken = null
      state.user = null
      state.queries = {}
      state.paymentIntents = {}
      return state
    })
    return { status: 'deleted', recoverable: false }
  }

  forget(queryId) {
    return forgetLocalState(this.config, queryId)
  }

  async privacyStatus() {
    const state = await readState(this.config)
    return {
      mode: 'local-custody-buyer-and-contributor',
      localStatePath: this.config.statePath,
      localQueryCapabilities: Object.keys(state.queries).length,
      localPaymentIntents: Object.keys(state.paymentIntents).length,
      contributorSessionConnected: Boolean(state.sessionToken),
      neverSentByThisApp: [
        'password',
        'Phantom session',
        'wallet private key',
        'seed phrase',
        'Claude API key',
        'local conversation archive',
      ],
      sentWhenNeeded: [
        'the current prompt and selected tool context to the configured Claude endpoint',
        'minimized research question and filters',
        'selected document handles',
        'query-scoped capability',
        'public payer address and transaction receipt during Pay.sh settlement',
        'contributor profile and preferences only when the user asks to save them',
      ],
      warning:
        'Local custody protects signing keys and stored conversations. It is not transaction anonymity: Solana addresses and receipts are public, and the configured Claude endpoint receives the current agent prompt.',
    }
  }

  async #api(path, init = {}) {
    return requireSuccess(
      await jsonRequest(`${this.config.apiOrigin}${path}`, init, { fetchImpl: this.fetchImpl }),
    )
  }

  async #authenticatedApi(path, init = {}, providedState = null) {
    const state = providedState || (await readState(this.config))
    if (!state.sessionToken) {
      throw new LocalAgentError(
        '이 작업은 기여자 계정 연결이 필요합니다. 로컬 터미널에서 Pay.sh 지갑으로 Obulus 계정을 연결하세요.',
        'authentication_required',
        401,
      )
    }
    const headers = new Headers(init.headers || {})
    headers.set('authorization', `Bearer ${state.sessionToken}`)
    return this.#api(path, { ...init, headers })
  }

  async #gateway(path, init = {}) {
    return requireSuccess(await this.#gatewayResult(path, init))
  }

  #gatewayResult(path, init = {}) {
    return jsonRequest(`${this.config.gatewayOrigin}${path}`, init, { fetchImpl: this.fetchImpl })
  }
}

function requireHumanAuthored(args) {
  if (args.humanAuthoredConfirmation !== 'I WROTE THIS EXPERIENCE') {
    throw new LocalAgentError(
      '실제 경험 답변은 사용자가 직접 작성했다는 확인이 필요합니다.',
      'human_authorship_required',
      403,
    )
  }
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function safeSearchResult(result) {
  return {
    queryId: result.queryId,
    decision: result.decision,
    reason: result.reason,
    liquidityState: result.liquidityState,
    aiBaselineEligible: result.aiBaselineEligible,
    requestedDocuments: result.requestedDocuments,
    candidateCount: result.candidateCount,
    matches: result.matches.map((match) => ({
      handle: match.handle,
      shelfId: match.shelfId,
      shelf: match.shelf,
      category: match.category,
      priceKrw: match.priceKrw,
      score: match.score,
      scoreBreakdown: match.scoreBreakdown
        ? {
            relevance: match.scoreBreakdown.relevance,
            termCoverage: match.scoreBreakdown.termCoverage,
            authority: match.scoreBreakdown.authority,
            trust: match.scoreBreakdown.trust,
            freshness: match.scoreBreakdown.freshness,
          }
        : undefined,
      demographics: match.demographics
        ? {
            ageBand: match.demographics.ageBand,
            region: match.demographics.region,
            household: match.demographics.household,
            field: match.demographics.field,
          }
        : null,
    })),
    quote: result.quote
      ? {
          currency: result.quote.currency,
          documentCount: result.quote.documentCount,
          totalPriceKrw: result.quote.totalPriceKrw,
        }
      : null,
    openCall: result.openCall
      ? {
          question: result.openCall.question,
          targetAnswers: result.openCall.targetAnswers,
          existingMatches: result.openCall.existingMatches,
          answersNeeded: result.openCall.answersNeeded,
          suggestedUnitPriceKrw: result.openCall.suggestedUnitPriceKrw,
          suggestedBudgetKrw: result.openCall.suggestedBudgetKrw,
        }
      : null,
    agentRun: result.agentRun
      ? {
          id: result.agentRun.id,
          model: result.agentRun.model,
          mode: result.agentRun.mode,
          steps: result.agentRun.steps,
          nextAction: result.agentRun.nextAction,
          requiresUserApproval: result.agentRun.requiresUserApproval,
        }
      : null,
  }
}
