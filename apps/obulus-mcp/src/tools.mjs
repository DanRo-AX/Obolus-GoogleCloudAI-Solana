import {
  AgentError,
  apiRequest,
  jsonBody,
  readState,
  requireQuery,
  updateState,
} from '../../../integrations/antigravity/openshelf/runtime/core.mjs'
import { payInvocation } from '../../../integrations/antigravity/openshelf/runtime/pay-command.mjs'
import { execFile } from 'node:child_process'
import { promisify, stripVTControlCharacters } from 'node:util'
import {
  callTool as callLegacyTool,
  tools as legacyTools,
} from '../../../integrations/antigravity/openshelf/runtime/tools.mjs'

import { runtimeConfig } from './config.mjs'

const execFileAsync = promisify(execFile)
const DEVNET_NETWORK = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1'

const objectSchema = (properties = {}, required = []) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
})
const string = (description, extra = {}) => ({ type: 'string', description, ...extra })
const integer = (description, extra = {}) => ({ type: 'integer', description, ...extra })
const stringArray = (description) => ({
  type: 'array',
  description,
  items: { type: 'string', minLength: 1 },
})

function productLanguage(value) {
  return value
    .replaceAll('OPENSHELF', 'Obulus')
    .replaceAll('OpenShelf', 'Obulus')
}

export const compatibilityTools = legacyTools.map((tool) => ({
  ...tool,
  description: productLanguage(tool.description),
}))

export const extendedTools = [
  {
    name: 'connect_wallet',
    description:
      'Connect a local Pay.sh Solana wallet to Obulus with one free SIWX ownership signature. This spends no USDC, never requests email or password, and never exposes the private key. Use only when a protected account, contributor, memory, earnings, or open-call action actually requires sign-in; never call it before free search.',
    inputSchema: objectSchema(
      {
        ageConfirmed14: {
          type: 'boolean',
          description: 'The user explicitly confirms they are at least 14 years old.',
        },
        payAccount: string(
          'Optional existing Pay.sh account name. Omit to use the local Pay.sh default account.',
          { maxLength: 64 },
        ),
      },
      ['ageConfirmed14'],
    ),
  },
  {
    name: 'search_public_evidence',
    description:
      'Search free provenance-bound official records. Results include source, license, date, record id and content hash and are never presented as paid firsthand human evidence.',
    inputSchema: objectSchema({
      query: string('Optional search text.', { maxLength: 500 }),
      limit: integer('Maximum records to return.', { minimum: 1, maximum: 20 }),
    }),
  },
  {
    name: 'preview_settlement_invoice',
    description:
      'Create a deterministic pre-payment invoice for selected human documents, including bundle root, owner share, protocol fee, network and asset. This does not spend money.',
    inputSchema: objectSchema(
      {
        queryId: string('Query id returned by ask_people.'),
        handles: stringArray('One or more handles returned for this query.'),
      },
      ['queryId', 'handles'],
    ),
  },
  {
    name: 'payment_progress',
    description:
      'Reconcile per-document unpaid, quoted and settled state for a payer before retrying. This never creates or signs a payment.',
    inputSchema: objectSchema(
      {
        queryId: string('Query id returned by ask_people.'),
        payer: string('Solana payer wallet address.'),
      },
      ['queryId', 'payer'],
    ),
  },
  {
    name: 'recover_paid_document',
    description:
      'Recover an already-settled human passage together with its immutable Solana settlement receipt. It cannot open an unpaid document.',
    inputSchema: objectSchema(
      {
        queryId: string('Query id returned by ask_people.'),
        handle: string('Previously settled document handle.'),
        payer: string('Solana payer wallet address used for settlement.'),
      },
      ['queryId', 'handle', 'payer'],
    ),
  },
  {
    name: 'manage_prepaid_wallet',
    description:
      'Read the authenticated wallet prepaid balance or request a withdrawal to its verified wallet. Withdrawal requires an exact confirmation and never exposes wallet-session secrets.',
    inputSchema: objectSchema(
      {
        action: string('Operation to perform.', { enum: ['balance', 'withdraw'] }),
        amountAtomic: string('Optional USDC atomic amount; omit to withdraw all.', {
          pattern: '^[1-9][0-9]*$',
        }),
        confirmation: string(
          'For withdrawal, exactly: WITHDRAW OBULUS PREPAID BALANCE',
        ),
      },
      ['action'],
    ),
  },
]

export const tools = [...compatibilityTools, ...extendedTools]

export async function callTool(name, args = {}, options = {}) {
  const config = options.config || runtimeConfig()
  const state = options.state || (await readState(config))
  const env = options.env || process.env
  const runProcess = options.execFile || execFileAsync
  if (compatibilityTools.some((tool) => tool.name === name)) {
    return callLegacyTool(name, args, { ...options, config, state })
  }
  const tool = extendedTools.find((candidate) => candidate.name === name)
  if (!tool) throw new AgentError(`Unknown tool: ${name}`, 'tool_not_found', 404)
  validateSchema(args, tool.inputSchema, 'arguments')

  switch (name) {
    case 'connect_wallet': {
      if (args.ageConfirmed14 !== true) {
        throw new AgentError(
          'Wallet account creation requires the user to confirm they are at least 14 years old.',
          'age_confirmation_required',
        )
      }
      const link = (
        await apiRequest(
          '/api/v1/auth/wallet/siwx',
          {
            method: 'POST',
            body: jsonBody({ ageConfirmed14: true }),
          },
          { config, state, auth: false },
        )
      ).body
      const resource = validateWalletSignInLink(link, config)
      const pay = payInvocation(env)
      const payArgs = [
        ...pay.args,
        'fetch',
        ...(args.payAccount ? ['--account', args.payAccount] : []),
        resource.href,
      ]
      let stdout
      try {
        ;({ stdout } = await runProcess(pay.command, payArgs, {
          env,
          timeout: 120_000,
          maxBuffer: 512 * 1024,
        }))
      } catch (error) {
        const detail = stripVTControlCharacters(
          String(error?.stderr || error?.stdout || error?.message || ''),
        ).trim()
        throw new AgentError(
          detail || 'Pay.sh could not complete the free wallet ownership signature.',
          error?.code === 'ENOENT' ? 'pay_not_installed' : 'wallet_signature_failed',
          400,
        )
      }
      let signed
      try {
        signed = JSON.parse(stripVTControlCharacters(String(stdout || '')).trim())
      } catch {
        throw new AgentError(
          'Pay.sh returned an invalid wallet sign-in response.',
          'invalid_wallet_session',
          502,
        )
      }
      validateWalletSession(signed)
      await updateState(config, (current) => {
        current.token = signed.sessionToken
        current.user = signed.user
        return current
      })
      return {
        connected: true,
        wallet: signed.wallet,
        user: signed.user,
        expiresAt: signed.expiresAt,
        network: link.network,
        usdcSpent: false,
        privateKeyExported: false,
      }
    }
    case 'search_public_evidence': {
      const params = new URLSearchParams({ limit: String(args.limit ?? 12) })
      if (args.query?.trim()) params.set('q', args.query.trim())
      return (
        await apiRequest(`/api/v1/public-evidence?${params}`, {}, {
          config,
          state,
          auth: false,
        })
      ).body
    }
    case 'preview_settlement_invoice': {
      const query = requireQuery(state, args.queryId)
      const handles = validateHandles(query, args.handles)
      return (
        await apiRequest(
          `/api/v1/questions/${encodeURIComponent(args.queryId)}/settlement-invoice`,
          {
            method: 'POST',
            headers: { 'x-openshelf-query-token': query.paymentAccessToken },
            body: jsonBody({ handles }),
          },
          { config, state, auth: false },
        )
      ).body
    }
    case 'payment_progress': {
      const query = requireQuery(state, args.queryId)
      validatePayer(args.payer)
      const params = new URLSearchParams({ payer: args.payer })
      return (
        await apiRequest(
          `/api/v1/questions/${encodeURIComponent(args.queryId)}/payment-progress?${params}`,
          { headers: { 'x-openshelf-query-token': query.paymentAccessToken } },
          { config, state, auth: false },
        )
      ).body
    }
    case 'recover_paid_document': {
      const query = requireQuery(state, args.queryId)
      validatePayer(args.payer)
      if (!query.handles.includes(args.handle)) {
        throw new AgentError('This handle was not quoted for the query.', 'invalid_handle')
      }
      const params = new URLSearchParams({ payer: args.payer })
      return (
        await apiRequest(
          `/api/v1/questions/${encodeURIComponent(args.queryId)}/paid-documents/${encodeURIComponent(args.handle)}?${params}`,
          { headers: { 'x-openshelf-query-token': query.paymentAccessToken } },
          { config, state, auth: false },
        )
      ).body
    }
    case 'manage_prepaid_wallet': {
      if (args.action === 'balance') {
        return (await apiRequest('/api/v1/prepaid/balance', {}, { config, state })).body
      }
      if (args.confirmation !== 'WITHDRAW OBULUS PREPAID BALANCE') {
        throw new AgentError(
          'Withdrawal requires confirmation exactly equal to WITHDRAW OBULUS PREPAID BALANCE.',
          'confirmation_required',
        )
      }
      return (
        await apiRequest(
          '/api/v1/prepaid/withdrawals',
          {
            method: 'POST',
            body: jsonBody({ amountAtomic: args.amountAtomic }),
          },
          { config, state },
        )
      ).body
    }
    default:
      throw new AgentError(`Unknown tool: ${name}`, 'tool_not_found', 404)
  }
}

function validateWalletSignInLink(link, config) {
  let resource
  try {
    resource = new URL(link?.resourceUrl || '')
  } catch {
    throw new AgentError('Obulus returned an invalid wallet sign-in URL.', 'unsafe_wallet_link', 502)
  }
  if (
    resource.origin !== config.apiOrigin
    || !resource.pathname.startsWith('/api/v1/auth/wallet/siwx/')
    || resource.search
    || resource.hash
    || link.network !== DEVNET_NETWORK
  ) {
    throw new AgentError(
      'Refusing a wallet sign-in link outside the configured Obulus Devnet API.',
      'unsafe_wallet_link',
      502,
    )
  }
  return resource
}

function validateWalletSession(value) {
  if (
    typeof value?.sessionToken !== 'string'
    || value.sessionToken.length < 16
    || typeof value?.wallet !== 'string'
    || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value.wallet)
    || typeof value?.expiresAt !== 'number'
    || value.expiresAt <= Date.now()
    || !value.user
    || typeof value.user !== 'object'
  ) {
    throw new AgentError(
      'Obulus returned an invalid wallet-authenticated session.',
      'invalid_wallet_session',
      502,
    )
  }
}

function validateHandles(query, values) {
  const handles = [...new Set(values)]
  if (handles.length < 1 || handles.length > 100) {
    throw new AgentError('Choose between 1 and 100 document handles.', 'invalid_arguments')
  }
  const unknown = handles.filter((handle) => !query.handles.includes(handle))
  if (unknown.length) {
    throw new AgentError(
      `Handles were not quoted for this query: ${unknown.join(', ')}`,
      'invalid_handles',
    )
  }
  return handles
}

function validatePayer(value) {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) {
    throw new AgentError('payer must be a valid base58 Solana address', 'invalid_arguments')
  }
}

function validateSchema(value, schema, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AgentError(`${path} must be an object`, 'invalid_arguments')
  }
  for (const required of schema.required || []) {
    if (value[required] === undefined) {
      throw new AgentError(`${path}.${required} is required`, 'invalid_arguments')
    }
  }
  if (schema.additionalProperties === false) {
    for (const key of Object.keys(value)) {
      if (!Object.hasOwn(schema.properties || {}, key)) {
        throw new AgentError(`${path}.${key} is not supported`, 'invalid_arguments')
      }
    }
  }
  for (const [key, child] of Object.entries(schema.properties || {})) {
    const current = value[key]
    if (current === undefined) continue
    if (child.type === 'string') {
      if (typeof current !== 'string') {
        throw new AgentError(`${path}.${key} must be a string`, 'invalid_arguments')
      }
      if (child.maxLength && current.length > child.maxLength) {
        throw new AgentError(`${path}.${key} is too long`, 'invalid_arguments')
      }
      if (child.pattern && !(new RegExp(child.pattern)).test(current)) {
        throw new AgentError(`${path}.${key} has an invalid format`, 'invalid_arguments')
      }
      if (child.enum && !child.enum.includes(current)) {
        throw new AgentError(`${path}.${key} must be one of: ${child.enum.join(', ')}`, 'invalid_arguments')
      }
    } else if (child.type === 'integer') {
      if (!Number.isSafeInteger(current)
        || (child.minimum !== undefined && current < child.minimum)
        || (child.maximum !== undefined && current > child.maximum)) {
        throw new AgentError(`${path}.${key} is outside the allowed range`, 'invalid_arguments')
      }
    } else if (child.type === 'array') {
      if (!Array.isArray(current) || current.some((item) => typeof item !== 'string' || !item)) {
        throw new AgentError(`${path}.${key} must be a non-empty string array`, 'invalid_arguments')
      }
    }
  }
}
