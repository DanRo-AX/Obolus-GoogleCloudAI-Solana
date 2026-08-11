import { LocalAgentError } from './errors.mjs'

const SECRET_PATTERNS = [
  { label: 'email address', pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu },
  { label: 'phone number', pattern: /(?<!\d)(?:\+?\d[\d ()-]{7,}\d)(?!\d)/gu },
  {
    label: 'wallet or account address',
    pattern: /(?<![1-9A-HJ-NP-Za-km-z])[1-9A-HJ-NP-Za-km-z]{32,44}(?![1-9A-HJ-NP-Za-km-z])/gu,
  },
  {
    label: 'secret-key material',
    pattern: /\b(?:seed phrase|mnemonic|private key|secret key|recovery phrase)\b/giu,
  },
  {
    label: 'secret-key byte array',
    pattern: /\[(?:\s*\d{1,3}\s*,){31,63}\s*\d{1,3}\s*\]/gu,
  },
  {
    label: 'long encoded secret',
    pattern: /\b(?:[0-9a-f]{64,}|[A-Za-z0-9+/]{80,}={0,2})\b/gu,
  },
]

const SECRET_KEYS =
  /(?:email|phone|password|private.?key|secret.?key|seed|mnemonic|recovery.?phrase|paymentAccessToken|sessionToken|signedTransaction|authorization|cookie)/iu

export function protectAgentMessage(message) {
  if (typeof message !== 'string' || !message.trim() || message.length > 20_000) {
    throw new LocalAgentError('The agent message must contain 1-20000 characters.', 'invalid_message')
  }
  const findings = []
  for (const { label, pattern } of SECRET_PATTERNS) {
    pattern.lastIndex = 0
    if (pattern.test(message)) findings.push(label)
  }
  const uniqueFindings = [...new Set(findings)]
  if (uniqueFindings.length) {
    throw new LocalAgentError(
      `Claude로 보내기 전에 직접 식별자 또는 비밀정보를 제거하세요: ${uniqueFindings.join(', ')}.`,
      'sensitive_agent_message_blocked',
      400,
      { findings: uniqueFindings },
    )
  }
  return message.trim()
}

export function minimizeQuestion(question, mode = 'strict') {
  if (typeof question !== 'string' || question.trim().length < 8 || question.length > 1_000) {
    throw new LocalAgentError(
      'The research question must contain 8-1000 characters.',
      'invalid_question',
    )
  }
  if (!['strict', 'redact'].includes(mode)) {
    throw new LocalAgentError('privacyMode must be strict or redact.', 'invalid_privacy_mode')
  }

  let minimized = question.trim()
  const findings = []
  for (const { label, pattern } of SECRET_PATTERNS) {
    pattern.lastIndex = 0
    if (!pattern.test(minimized)) continue
    findings.push(label)
    if (mode === 'redact') {
      pattern.lastIndex = 0
      minimized = minimized.replace(pattern, `[redacted ${label}]`)
    }
  }
  const uniqueFindings = [...new Set(findings)]
  if (mode === 'strict' && uniqueFindings.length) {
    throw new LocalAgentError(
      `The question contains direct identifiers or secrets: ${uniqueFindings.join(', ')}. Remove them locally or retry with privacyMode=redact.`,
      'sensitive_query_blocked',
      400,
      { findings: uniqueFindings },
    )
  }
  return { question: minimized, redactions: uniqueFindings }
}

export function minimalFilters(filters = {}) {
  if (!filters || typeof filters !== 'object' || Array.isArray(filters)) {
    throw new LocalAgentError('filters must be one object.', 'invalid_filters')
  }
  const allowed = new Set(['category', 'maxUnitPriceKrw', 'ageBand', 'region', 'household', 'field'])
  const output = {}
  for (const [key, value] of Object.entries(filters)) {
    if (!allowed.has(key)) {
      throw new LocalAgentError(`Unsupported filter: ${key}`, 'invalid_filters')
    }
    if (value !== undefined && value !== null && value !== '') output[key] = value
  }
  return output
}

export function redactModelSecrets(value, key = '') {
  if (SECRET_KEYS.test(key)) return '[redacted local secret]'
  if (Array.isArray(value)) return value.map((item) => redactModelSecrets(item))
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value).map(([childKey, child]) => [
      childKey,
      redactModelSecrets(child, childKey),
    ]),
  )
}
