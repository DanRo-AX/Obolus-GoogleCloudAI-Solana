import { randomUUID } from 'node:crypto'

import {
  DEVNET_NETWORK,
  AgentError,
  apiRequest,
  assertDevnetQuote,
  compactQueryForState,
  gatewayRequest,
  jsonBody,
  paymentPlan,
  readState,
  requireQuery,
  runtimeConfig,
  writeState,
} from './core.mjs'

const objectSchema = (properties = {}, required = []) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
})
const string = (description, extra = {}) => ({ type: 'string', description, ...extra })
const integer = (description, extra = {}) => ({ type: 'integer', description, ...extra })
const boolean = (description) => ({ type: 'boolean', description })
const stringArray = (description) => ({
  type: 'array',
  description,
  items: { type: 'string' },
})

const filtersSchema = {
  type: 'object',
  description: 'Optional human targeting filters. Omit unknown fields.',
  properties: {
    category: string('One of life, food, family, health, business, sales, engineering, education, sports, travel, money.'),
    maxUnitPriceKrw: integer('Maximum KRW price for one existing document.', { minimum: 1 }),
    ageBand: string('One of under-25, 25-34, 35-44, 45-54, 55-plus.'),
    region: string('One of seoul, gyeonggi, metro, town, abroad.'),
    household: string('One of alone, partner, kids, parents, shared.'),
    field: string('Contributor field filter.'),
  },
  additionalProperties: false,
}

export const tools = [
  {
    name: 'account_status',
    description: 'Check the locally authenticated OPENSHELF account and KRW balance.',
    inputSchema: objectSchema(),
  },
  {
    name: 'ask_people',
    description:
      'Resolve a question against human documents, returning coverage, exact prices, and an open-call draft when human supply is missing. This does not spend money.',
    inputSchema: objectSchema(
      {
        question: string('The concrete question to ask people.', { minLength: 8, maxLength: 2000 }),
        requestedDocuments: integer('Maximum human documents to rank.', { minimum: 1, maximum: 20 }),
        budgetKrw: integer('Optional total budget ceiling in KRW.', { minimum: 1 }),
        filters: filtersSchema,
      },
      ['question'],
    ),
  },
  {
    name: 'generate_ai_baseline',
    description:
      'Generate a free, clearly labelled general AI orientation for a prior query. It never counts as human evidence and cannot be sold.',
    inputSchema: objectSchema({ queryId: string('Query id returned by ask_people.') }, ['queryId']),
  },
  {
    name: 'prepare_evidence_payment',
    description:
      'Prepare an exact Devnet x402 payment for selected matched human documents. Returns a URL for the Pay MCP curl tool; it never signs or pays itself.',
    inputSchema: objectSchema(
      {
        queryId: string('Query id returned by ask_people.'),
        handles: stringArray('One or more document handles from that query.'),
      },
      ['queryId', 'handles'],
    ),
  },
  {
    name: 'synthesize_human_answer',
    description:
      'Synthesize only already-paid human evidence for a query, preserving citations, consensus, and disagreements.',
    inputSchema: objectSchema(
      {
        queryId: string('Query id returned by ask_people.'),
        handles: stringArray('Paid document handles returned by Pay curl.'),
      },
      ['queryId', 'handles'],
    ),
  },
  {
    name: 'prepare_open_call',
    description:
      'Prepare one aggregate Devnet escrow payment for a new human open call. The returned URL must be passed to Pay curl only after user approval.',
    inputSchema: objectSchema(
      {
        question: string('Question contributors will answer.', { minLength: 8, maxLength: 2000 }),
        unitPriceKrw: integer('Reward for each accepted human answer.', { minimum: 1 }),
        target: integer('Number of human answers requested.', { minimum: 1, maximum: 100 }),
        chatId: string('Stable local chat id used to retrieve incoming answers.'),
        shelf: string('Human cohort or shelf label.', { minLength: 2, maxLength: 120 }),
        category: string('OpenShelf category id.'),
        filters: filtersSchema,
      },
      ['question', 'unitPriceKrw', 'target', 'shelf', 'category'],
    ),
  },
  {
    name: 'open_call_status',
    description: 'Check a prepared funding quote and/or retrieve human answers for its chat id.',
    inputSchema: objectSchema({
      quoteId: string('Funding quote id to inspect.'),
      chatId: string('Chat id whose human answers should be returned.'),
    }),
  },
  {
    name: 'cancel_open_call',
    description: 'Cancel an owned open call and trigger the existing unused-slot refund rules.',
    inputSchema: objectSchema({ openCallId: string('Open call id to cancel.') }, ['openCallId']),
  },
  {
    name: 'submit_document_feedback',
    description: 'Rate or report a human document that this payer actually opened.',
    inputSchema: objectSchema(
      {
        queryId: string('Original query id.'),
        handle: string('Opened document handle.'),
        payer: string('Pay.sh Solana payer address used for settlement.'),
        outcome: string('helpful, not_helpful, or report.', {
          enum: ['helpful', 'not_helpful', 'report'],
        }),
        reason: string('Required context for reports; optional otherwise.', { maxLength: 1000 }),
      },
      ['queryId', 'handle', 'payer', 'outcome'],
    ),
  },
  {
    name: 'get_profile',
    description: 'Get the signed-in contributor profile, preferences, and payout-wallet status.',
    inputSchema: objectSchema(),
  },
  {
    name: 'update_profile',
    description:
      'Create or replace the signed-in contributor profile. Demographic fields control eligibility; do not infer private details without the user.',
    inputSchema: objectSchema(
      {
        handle: string('Anonymous public handle.', { minLength: 3, maxLength: 32 }),
        ageBand: string('under-25, 25-34, 35-44, 45-54, or 55-plus.'),
        region: string('seoul, gyeonggi, metro, town, or abroad.'),
        household: string('alone, partner, kids, parents, or shared.'),
        field: string('Primary lived-experience field.'),
        years: string('under-1, 1-3, 3-7, or 7-plus.'),
        speaksTo: stringArray('Categories this contributor can answer from experience.'),
        autoMatch: boolean('Allow high-confidence automatic reuse of existing human memory.'),
        agents: boolean('Allow agent delivery of matching questions.'),
        browserAlerts: boolean('Enable browser alerts.'),
        emailAlerts: boolean('Enable email alerts.'),
      },
      ['handle', 'ageBand', 'region', 'household', 'field', 'years', 'speaksTo', 'autoMatch', 'agents'],
    ),
  },
  {
    name: 'prepare_payout_wallet_link',
    description:
      'Create a one-time SIWX URL that lets Pay.sh prove its local Devnet wallet as the contributor payout wallet without exporting a private key.',
    inputSchema: objectSchema(),
  },
  {
    name: 'update_preferences',
    description: 'Update contributor matching and notification preferences.',
    inputSchema: objectSchema({
      autoMatch: boolean('Toggle memory auto-match.'),
      agents: boolean('Toggle agent question delivery.'),
      browserAlerts: boolean('Toggle browser alerts.'),
      emailAlerts: boolean('Toggle email alerts.'),
    }),
  },
  {
    name: 'list_opportunities',
    description: 'List open paid questions, including eligibility and recommendation signals for this contributor.',
    inputSchema: objectSchema({ eligibleOnly: boolean('Return only open calls this contributor can answer.') }),
  },
  {
    name: 'manage_reservation',
    description: 'Reserve or release one contributor answer slot before composing an answer.',
    inputSchema: objectSchema(
      {
        action: string('reserve or release.', { enum: ['reserve', 'release'] }),
        openCallId: string('Open call id.'),
      },
      ['action', 'openCallId'],
    ),
  },
  {
    name: 'submit_human_answer',
    description:
      'Submit the contributor’s lived-experience answer to a reserved open call. Never generate or rewrite the answer as if it were human experience.',
    inputSchema: objectSchema(
      {
        openCallId: string('Reserved open call id.'),
        answer: string('Contributor-authored final answer.', { minLength: 10, maxLength: 10000 }),
        interviewResponses: {
          type: 'array',
          description: 'Optional warm-up responses authored by the contributor.',
          items: objectSchema(
            {
              questionId: string('Warm-up question id.'),
              prompt: string('Warm-up prompt.'),
              answer: string('Contributor-authored response.'),
            },
            ['questionId', 'prompt', 'answer'],
          ),
        },
      },
      ['openCallId', 'answer'],
    ),
  },
  {
    name: 'shelf_starters',
    description: 'List or generate free AI interview prompts that help a contributor seed human memories.',
    inputSchema: objectSchema({ action: string('list or generate.', { enum: ['list', 'generate'] }) }, ['action']),
  },
  {
    name: 'answer_shelf_starter',
    description:
      'Turn a contributor-authored answer to an AI starter prompt into a sellable human memory. The answer must come from the contributor.',
    inputSchema: objectSchema(
      {
        starterId: string('Shelf starter id.'),
        answer: string('Contributor-authored lived experience.', { minLength: 10, maxLength: 10000 }),
        priceKrw: integer('Future document opening price.', { minimum: 1 }),
      },
      ['starterId', 'answer', 'priceKrw'],
    ),
  },
  {
    name: 'notifications',
    description: 'List contributor notifications or mark selected/all notifications read.',
    inputSchema: objectSchema(
      {
        action: string('list or mark_read.', { enum: ['list', 'mark_read'] }),
        ids: stringArray('Notification ids. Empty means all when marking read.'),
      },
      ['action'],
    ),
  },
  {
    name: 'manage_memory',
    description: 'List, lock/unlock, correct, or dispute the contributor’s human memory records.',
    inputSchema: objectSchema(
      {
        action: string('list, lock, correct, or dispute.', {
          enum: ['list', 'lock', 'correct', 'dispute'],
        }),
        memoryId: string('Required except for list.'),
        locked: boolean('Required for lock.'),
        answer: string('Contributor-authored replacement required for correct.'),
        reason: string('Reason required for dispute.'),
      },
      ['action'],
    ),
  },
  {
    name: 'earnings_and_claims',
    description: 'Inspect contributor earnings, holds, claimable amounts, and on-chain payout claim statuses.',
    inputSchema: objectSchema(),
  },
  {
    name: 'account_data',
    description: 'Get balance, export private account data, or permanently delete the account with an exact confirmation.',
    inputSchema: objectSchema(
      {
        action: string('balance, export, or delete.', { enum: ['balance', 'export', 'delete'] }),
        confirmation: string('For delete only, must exactly equal DELETE MY OPENSHELF ACCOUNT.'),
      },
      ['action'],
    ),
  },
  {
    name: 'lookup_contributor',
    description: 'Read a public contributor manifest and its sellable human-memory links.',
    inputSchema: objectSchema({ handle: string('Public contributor handle.') }, ['handle']),
  },
]

export async function callTool(name, args = {}, options = {}) {
  const config = options.config || runtimeConfig()
  const state = options.state || (await readState(config))
  switch (name) {
    case 'account_status':
      return (await apiRequest('/api/v1/auth/me', {}, { config, state })).body
    case 'ask_people': {
      const result = (
        await apiRequest(
          '/api/v1/questions/resolve',
          {
            method: 'POST',
            body: jsonBody({
              question: args.question,
              requestedDocuments: args.requestedDocuments ?? 5,
              budgetKrw: args.budgetKrw,
              filters: args.filters || {},
            }),
          },
          { config, state, auth: false },
        )
      ).body
      state.queries[result.queryId] = compactQueryForState({ ...result, question: args.question })
      await writeState(state, config)
      const { paymentAccessToken: _secret, ...safe } = result
      return {
        ...safe,
        nextAction:
          result.decision === 'hit'
            ? 'Choose only the human documents the user wants, then call prepare_evidence_payment.'
            : 'Offer the free AI baseline for orientation and prepare a funded open call for missing human evidence.',
      }
    }
    case 'generate_ai_baseline': {
      const query = requireQuery(state, args.queryId)
      return (
        await apiRequest(
          `/api/v1/questions/${encodeURIComponent(args.queryId)}/ai-baseline`,
          {
            method: 'POST',
            headers: { 'x-openshelf-query-token': query.paymentAccessToken },
          },
          { config, state, auth: false },
        )
      ).body
    }
    case 'prepare_evidence_payment':
      return prepareEvidencePayment(args, state, config)
    case 'synthesize_human_answer': {
      const query = requireQuery(state, args.queryId)
      return (
        await apiRequest(
          '/api/v1/answers/synthesize',
          {
            method: 'POST',
            headers: { 'x-openshelf-query-token': query.paymentAccessToken },
            body: jsonBody({ queryId: args.queryId, handles: args.handles }),
          },
          { config, state, auth: false },
        )
      ).body
    }
    case 'prepare_open_call': {
      const chatId = args.chatId || `agy_${randomUUID()}`
      const input = {
        question: args.question,
        unitPrice: args.unitPriceKrw,
        target: args.target,
        chatId,
        shelf: args.shelf,
        category: args.category,
        filters: args.filters || {},
      }
      const quote = (
        await apiRequest(
          '/api/v1/open-call-funding-quotes',
          { method: 'POST', body: jsonBody(input) },
          { config, state },
        )
      ).body
      const plan = paymentPlan(
        `${config.gatewayOrigin}${quote.resourcePath}`,
        quote,
        `Fund ${args.target} human answer slot${args.target === 1 ? '' : 's'} for “${args.question}”`,
      )
      return { ...plan, chatId }
    }
    case 'open_call_status': {
      if (!args.quoteId && !args.chatId) {
        throw new AgentError('quoteId or chatId is required', 'invalid_arguments')
      }
      const result = {}
      if (args.quoteId) {
        result.funding = (
          await apiRequest(
            `/api/v1/open-call-funding-quotes/${encodeURIComponent(args.quoteId)}`,
            {},
            { config, state },
          )
        ).body
      }
      if (args.chatId) {
        result.answers = (
          await apiRequest(
            `/api/v1/chats/${encodeURIComponent(args.chatId)}/answers`,
            {},
            { config, state },
          )
        ).body
      }
      return result
    }
    case 'cancel_open_call':
      return (
        await apiRequest(
          `/api/v1/open-calls/${encodeURIComponent(args.openCallId)}`,
          { method: 'DELETE' },
          { config, state },
        )
      ).body
    case 'submit_document_feedback': {
      const query = requireQuery(state, args.queryId)
      const params = new URLSearchParams({ payer: args.payer })
      return (
        await apiRequest(
          `/api/v1/questions/${encodeURIComponent(args.queryId)}/paid-documents/${encodeURIComponent(args.handle)}/feedback?${params}`,
          {
            method: 'POST',
            headers: { 'x-openshelf-query-token': query.paymentAccessToken },
            body: jsonBody({ outcome: args.outcome, reason: args.reason }),
          },
          { config, state, auth: false },
        )
      ).body
    }
    case 'get_profile':
      return (await apiRequest('/api/v1/profile', {}, { config, state })).body
    case 'update_profile':
      return (
        await apiRequest(
          '/api/v1/profile',
          {
            method: 'POST',
            body: jsonBody({ ...args, wallet: null }),
          },
          { config, state },
        )
      ).body
    case 'prepare_payout_wallet_link': {
      const link = (
        await apiRequest(
          '/api/v1/profile/wallet/siwx',
          { method: 'POST' },
          { config, state },
        )
      ).body
      if (link.network !== DEVNET_NETWORK) {
        throw new AgentError('Refusing wallet link outside Solana Devnet.', 'unsafe_network')
      }
      return {
        status: 'signature_required',
        paymentUrl: link.resourceUrl,
        network: link.network,
        expiresAt: link.expiresAt,
        nextAction:
          'Explain that this signs in but spends no USDC. After the user agrees, call the Pay MCP curl tool with paymentUrl and GET. Pay will request local wallet approval.',
      }
    }
    case 'update_preferences':
      return (
        await apiRequest(
          '/api/v1/profile/preferences',
          { method: 'POST', body: jsonBody(args) },
          { config, state },
        )
      ).body
    case 'list_opportunities': {
      const calls = (await apiRequest('/api/v1/open-calls', {}, { config, state })).body
      return args.eligibleOnly
        ? calls.filter((call) => call.eligible && call.status === 'open' && call.answered < call.target)
        : calls
    }
    case 'manage_reservation': {
      const path = `/api/v1/open-calls/${encodeURIComponent(args.openCallId)}/reservation${
        args.action === 'release' ? '/release' : ''
      }`
      return (
        await apiRequest(path, { method: 'POST' }, { config, state })
      ).body ?? { status: 'released', openCallId: args.openCallId }
    }
    case 'submit_human_answer':
      return (
        await apiRequest(
          `/api/v1/open-calls/${encodeURIComponent(args.openCallId)}/answers`,
          {
            method: 'POST',
            body: jsonBody({
              answer: args.answer,
              interviewResponses: args.interviewResponses || [],
            }),
          },
          { config, state },
        )
      ).body
    case 'shelf_starters':
      return (
        await apiRequest(
          '/api/v1/shelf-starters',
          args.action === 'generate' ? { method: 'POST' } : {},
          { config, state },
        )
      ).body
    case 'answer_shelf_starter':
      return (
        await apiRequest(
          `/api/v1/shelf-starters/${encodeURIComponent(args.starterId)}/answer`,
          {
            method: 'POST',
            body: jsonBody({ answer: args.answer, priceKrw: args.priceKrw }),
          },
          { config, state },
        )
      ).body
    case 'notifications':
      if (args.action === 'list') {
        return (await apiRequest('/api/v1/notifications', {}, { config, state })).body
      }
      await apiRequest(
        '/api/v1/notifications/read',
        { method: 'POST', body: jsonBody({ ids: args.ids || [] }) },
        { config, state },
      )
      return { status: 'marked_read', ids: args.ids || [] }
    case 'manage_memory':
      return manageMemory(args, state, config)
    case 'earnings_and_claims': {
      const [earnings, claims] = await Promise.all([
        apiRequest('/api/v1/earnings', {}, { config, state }),
        apiRequest('/api/v1/payout-claims', {}, { config, state }),
      ])
      return { earnings: earnings.body, payoutClaims: claims.body }
    }
    case 'account_data':
      return accountData(args, state, config)
    case 'lookup_contributor':
      return (
        await apiRequest(
          `/api/v1/contributors/${encodeURIComponent(args.handle)}`,
          {},
          { config, state, auth: false },
        )
      ).body
    default:
      throw new AgentError(`Unknown tool: ${name}`, 'tool_not_found', 404)
  }
}

async function prepareEvidencePayment(args, state, config) {
  const query = requireQuery(state, args.queryId)
  const handles = [...new Set(args.handles || [])]
  if (handles.length < 1 || handles.length > 100) {
    throw new AgentError('Choose between 1 and 100 document handles.', 'invalid_arguments')
  }
  const unknown = handles.filter((handle) => !query.handles.includes(handle))
  if (unknown.length) {
    throw new AgentError(`Handles were not quoted for this query: ${unknown.join(', ')}`, 'invalid_handles')
  }
  if (handles.length === 1) {
    const path = `/api/v1/paid-documents/${encodeURIComponent(args.queryId)}/${encodeURIComponent(handles[0])}`
    const response = await fetch(`${config.gatewayOrigin}${path}`, {
      headers: { accept: 'application/json' },
    })
    const body = await response.json().catch(() => null)
    if (response.status !== 402 || !body?.quote) {
      throw new AgentError(
        body?.error?.message || `Expected an unpaid x402 quote, received HTTP ${response.status}`,
        'quote_unavailable',
      )
    }
    return paymentPlan(
      `${config.gatewayOrigin}${path}`,
      assertDevnetQuote(body.quote),
      `Open human document ${handles[0]}`,
    )
  }
  const prepared = (
    await gatewayRequest(
      '/api/v1/payment-bundles',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-openshelf-query-token': query.paymentAccessToken,
        },
        body: jsonBody({ queryId: args.queryId, handles }),
      },
      { config },
    )
  ).body
  return paymentPlan(
    prepared.resourceUrl || `${config.gatewayOrigin}${prepared.quote.resourcePath}`,
    prepared.quote,
    `Open ${handles.length} exact human documents in one aggregate payment`,
  )
}

async function manageMemory(args, state, config) {
  if (args.action === 'list') {
    return (await apiRequest('/api/v1/memory', {}, { config, state })).body
  }
  if (!args.memoryId) throw new AgentError('memoryId is required', 'invalid_arguments')
  const base = `/api/v1/memory/${encodeURIComponent(args.memoryId)}`
  if (args.action === 'lock') {
    if (typeof args.locked !== 'boolean') {
      throw new AgentError('locked must be true or false', 'invalid_arguments')
    }
    return (
      await apiRequest(
        base,
        { method: 'PATCH', body: jsonBody({ locked: args.locked }) },
        { config, state },
      )
    ).body
  }
  if (args.action === 'correct') {
    if (!args.answer) throw new AgentError('answer is required', 'invalid_arguments')
    return (
      await apiRequest(
        `${base}/corrections`,
        { method: 'POST', body: jsonBody({ answer: args.answer }) },
        { config, state },
      )
    ).body
  }
  if (!args.reason) throw new AgentError('reason is required', 'invalid_arguments')
  return (
    await apiRequest(
      `${base}/dispute`,
      { method: 'POST', body: jsonBody({ reason: args.reason }) },
      { config, state },
    )
  ).body
}

async function accountData(args, state, config) {
  if (args.action === 'balance') {
    return (await apiRequest('/api/v1/account/balance', {}, { config, state })).body
  }
  if (args.action === 'export') {
    return (await apiRequest('/api/v1/account/export', {}, { config, state })).body
  }
  if (args.confirmation !== 'DELETE MY OPENSHELF ACCOUNT') {
    throw new AgentError(
      'Permanent deletion requires confirmation exactly equal to DELETE MY OPENSHELF ACCOUNT.',
      'confirmation_required',
    )
  }
  await apiRequest('/api/v1/account', { method: 'DELETE' }, { config, state })
  state.token = null
  state.user = null
  state.queries = {}
  await writeState(state, config)
  return { status: 'deleted', recoverable: false }
}
