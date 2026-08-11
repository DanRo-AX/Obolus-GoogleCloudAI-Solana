import { createHash, randomUUID } from 'node:crypto'

import { LocalAgentError } from './errors.mjs'
import { jsonRequest, requireSuccess } from './http.mjs'
import { minimalFilters, minimizeQuestion } from './privacy.mjs'
import { exactBundleQuote, exactDocumentQuote, paymentPlan } from './quotes.mjs'
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

  forget(queryId) {
    return forgetLocalState(this.config, queryId)
  }

  async privacyStatus() {
    const state = await readState(this.config)
    return {
      mode: 'accountless-buyer',
      localStatePath: this.config.statePath,
      localQueryCapabilities: Object.keys(state.queries).length,
      localPaymentIntents: Object.keys(state.paymentIntents).length,
      neverSentByThisApp: [
        'email',
        'password',
        'profile',
        'Phantom session',
        'wallet private key',
        'seed phrase',
      ],
      sentWhenNeeded: [
        'minimized research question and filters',
        'selected document handles',
        'query-scoped capability',
        'public payer address and transaction receipt during Pay.sh settlement',
      ],
      warning:
        'This is data minimization and local key custody, not transaction anonymity. Solana addresses and receipts are public.',
    }
  }

  async #api(path, init = {}) {
    return requireSuccess(
      await jsonRequest(`${this.config.apiOrigin}${path}`, init, { fetchImpl: this.fetchImpl }),
    )
  }

  async #gateway(path, init = {}) {
    return requireSuccess(await this.#gatewayResult(path, init))
  }

  #gatewayResult(path, init = {}) {
    return jsonRequest(`${this.config.gatewayOrigin}${path}`, init, { fetchImpl: this.fetchImpl })
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
