import { LocalAgentError } from './errors.mjs'

const object = (properties = {}, required = []) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
})
const string = (description, extra = {}) => ({ type: 'string', description, ...extra })
const integer = (description, extra = {}) => ({ type: 'integer', description, ...extra })
const stringArray = (description) => ({ type: 'array', description, items: { type: 'string' } })

export const tools = [
  {
    name: 'local_privacy_status',
    description:
      'Explain exactly what remains local and what the accountless buyer path sends to Obulus or Solana.',
    inputSchema: object(),
  },
  {
    name: 'search_human_evidence',
    description:
      'Search safe human-evidence metadata without an account, email, profile, Phantom session, or wallet. Direct identifiers are blocked by default.',
    inputSchema: object(
      {
        question: string('Research question without direct personal identifiers.', {
          minLength: 8,
          maxLength: 1_000,
        }),
        requestedDocuments: integer('Maximum ranked documents.', { minimum: 1, maximum: 20 }),
        budgetKrw: integer('Optional KRW budget ceiling.', { minimum: 1 }),
        privacyMode: string('strict blocks identifiers; redact removes them locally.', {
          enum: ['strict', 'redact'],
        }),
        filters: object({
          category: string('Evidence category.'),
          maxUnitPriceKrw: integer('Maximum KRW price per document.', { minimum: 1 }),
          ageBand: string('Coarse age band.'),
          region: string('Coarse region band.'),
          household: string('Coarse household band.'),
          field: string('Contributor field.'),
        }),
      },
      ['question'],
    ),
  },
  {
    name: 'generate_ai_baseline',
    description:
      'Generate free general orientation for a local query. It is explicitly not human evidence.',
    inputSchema: object({ queryId: string('Query id returned by search.') }, ['queryId']),
  },
  {
    name: 'prepare_evidence_payment',
    description:
      'Validate and prepare an exact Devnet payment. This tool never signs or exposes an executable URL; the user must approve its one-time intent interactively before the constrained Pay.sh MCP can execute it.',
    inputSchema: object(
      {
        queryId: string('Local query id.'),
        handles: stringArray('Selected evidence handles from that query.'),
      },
      ['queryId', 'handles'],
    ),
  },
  {
    name: 'evidence_payment_status',
    description:
      'Recover or inspect the exact paid research job without starting another payment.',
    inputSchema: object(
      { queryId: string('Local query id.'), jobId: string('Research job or quote id.') },
      ['queryId', 'jobId'],
    ),
  },
  {
    name: 'synthesize_paid_evidence',
    description:
      'Synthesize only server-verified paid evidence from the local query capability.',
    inputSchema: object(
      { queryId: string('Local query id.'), handles: stringArray('Paid evidence handles.') },
      ['queryId', 'handles'],
    ),
  },
  {
    name: 'forget_local_query',
    description: 'Delete one local query capability, or all local state when queryId is omitted.',
    inputSchema: object({ queryId: string('Optional query id to forget.') }),
  },
]

export async function callTool(name, args, marketplace) {
  const tool = tools.find((candidate) => candidate.name === name)
  if (!tool) throw new LocalAgentError(`Unknown tool: ${name}`, 'tool_not_found', 404)
  validate(args || {}, tool.inputSchema, 'arguments')
  switch (name) {
    case 'local_privacy_status':
      return marketplace.privacyStatus()
    case 'search_human_evidence':
      return marketplace.search(args)
    case 'generate_ai_baseline':
      return marketplace.baseline(args)
    case 'prepare_evidence_payment':
      return marketplace.preparePayment(args)
    case 'evidence_payment_status':
      return marketplace.paymentStatus(args)
    case 'synthesize_paid_evidence':
      return marketplace.synthesize(args)
    case 'forget_local_query':
      return marketplace.forget(args.queryId)
    default:
      throw new LocalAgentError(`Unknown tool: ${name}`, 'tool_not_found', 404)
  }
}

function validate(value, schema, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new LocalAgentError(`${path} must be an object.`, 'invalid_arguments')
  }
  for (const required of schema.required || []) {
    if (value[required] === undefined) {
      throw new LocalAgentError(`${path}.${required} is required.`, 'invalid_arguments')
    }
  }
  for (const key of Object.keys(value)) {
    if (!Object.hasOwn(schema.properties || {}, key)) {
      throw new LocalAgentError(`${path}.${key} is not supported.`, 'invalid_arguments')
    }
  }
  for (const [key, child] of Object.entries(schema.properties || {})) {
    if (value[key] === undefined) continue
    validateValue(value[key], child, `${path}.${key}`)
  }
}

function validateValue(value, schema, path) {
  if (schema.type === 'object') return validate(value, schema, path)
  if (schema.type === 'array') {
    if (!Array.isArray(value)) throw new LocalAgentError(`${path} must be an array.`, 'invalid_arguments')
    return value.forEach((item, index) => validateValue(item, schema.items, `${path}[${index}]`))
  }
  if (schema.type === 'string' && typeof value !== 'string') {
    throw new LocalAgentError(`${path} must be a string.`, 'invalid_arguments')
  }
  if (schema.type === 'integer' && !Number.isSafeInteger(value)) {
    throw new LocalAgentError(`${path} must be an integer.`, 'invalid_arguments')
  }
  if (schema.minLength !== undefined && value.trim().length < schema.minLength) {
    throw new LocalAgentError(`${path} is too short.`, 'invalid_arguments')
  }
  if (schema.maxLength !== undefined && value.length > schema.maxLength) {
    throw new LocalAgentError(`${path} is too long.`, 'invalid_arguments')
  }
  if (schema.minimum !== undefined && value < schema.minimum) {
    throw new LocalAgentError(`${path} is below the minimum.`, 'invalid_arguments')
  }
  if (schema.maximum !== undefined && value > schema.maximum) {
    throw new LocalAgentError(`${path} exceeds the maximum.`, 'invalid_arguments')
  }
  if (schema.enum && !schema.enum.includes(value)) {
    throw new LocalAgentError(`${path} must be one of ${schema.enum.join(', ')}.`, 'invalid_arguments')
  }
}
