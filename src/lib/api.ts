import type { CategoryId } from '@/data/categories'
import type { Issue } from '@/lib/quality'
import type { InterviewResponse, MemoryEntry, Order, Profile } from '@/state/ui'

export const BACKEND_ENABLED = import.meta.env.VITE_BACKEND_ENABLED !== 'false'

const API_BASE = import.meta.env.VITE_API_BASE ?? ''

export type TargetFilters = {
  category?: CategoryId
  maxUnitPriceKrw?: number
  ageBand?: string
  region?: string
  household?: string
  field?: CategoryId
}

export type DemographicBands = {
  ageBand: string
  region: string
  household: string
  field: CategoryId
}

type ScoreBreakdown = {
  relevance: number
  termCoverage: number
  trust: number
  freshness: number
  authority: number
}

export type ResolvedMatch = {
  handle: string
  shelfId: string
  shelf: string
  category: string
  priceKrw: number
  score: number
  scoreBreakdown: ScoreBreakdown
  demographics?: DemographicBands
}

export type Resolution = {
  queryId: string
  /** Returned once and kept with the local chat for safe payment recovery. */
  paymentAccessToken: string
  decision: 'hit' | 'miss'
  reason:
    | 'coverage_ready'
    | 'no_relevant_documents'
    | 'insufficient_coverage'
    | 'budget_too_low'
  liquidityState: 'ai_liquidity_only' | 'hybrid_coverage' | 'human_covered'
  aiBaselineEligible: boolean
  requestedDocuments: number
  candidateCount: number
  matches: ResolvedMatch[]
  quote?: {
    currency: 'KRW'
    documentCount: number
    totalPriceKrw: number
  }
  openCall?: {
    question: string
    targetAnswers: number
    existingMatches: number
    answersNeeded: number
    suggestedUnitPriceKrw: number
    suggestedBudgetKrw: number
  }
}

export type AiBaseline = {
  id: string
  queryId: string
  kind: 'ai_baseline'
  orientation: string
  generalPoints: string[]
  humanGaps: string[]
  questionsForPeople: string[]
  model: string
  mode: 'vertex' | 'gemini_api' | string
  policyVersion: string
  generatedAt: number
  expiresAt: number
  priceKrw: 0
  sellable: false
  countsAsHumanCoverage: false
}

export type AiBaselineResult = {
  status: 'generated' | 'cached' | 'unavailable'
  baseline?: AiBaseline | null
}

export type ShelfStarter = {
  id: string
  prompt: string
  rationale: string
  category: CategoryId
  source: 'ai_interview_prompt'
  buyerWaiting: false
  guaranteedRewardKrw: 0
  generatedAt: number
  expiresAt: number
}

export type ShelfStarterResult = {
  status: 'generated' | 'cached' | 'unavailable'
  starters: ShelfStarter[]
}

export type Account = {
  id: string
  email: string
  role: 'user' | 'admin'
  createdAt: number
}

export type BalanceSummary = {
  currency: 'KRW_SANDBOX'
  availableKrw: number
  reservedKrw: number
  heldKrw: number
}

export type AuthSession = {
  user: Account
  balance: BalanceSummary
}

export type DisputeCase = {
  memoryId: string
  userId: string
  status: 'pending' | 'approved' | 'rejected'
  reason: string
  reviewNote?: string
  createdAt: number
  reviewedAt?: number
}

export type ChatAnswer = {
  id: string
  openCallId: string
  handle: string
  shelf: string
  excerpt: string
  price: number
  createdAt: number
  demographics?: DemographicBands
}

export class ApiError extends Error {
  status: number
  code: string

  constructor(message: string, status: number, code = 'api_error') {
    super(message)
    this.status = status
    this.code = code
  }
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      credentials: 'include',
    })
  } catch {
    throw new ApiError(
      'OPENSHELF backend is not reachable. Start it on port 8787.',
      0,
      'offline',
    )
  }

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as
      | { error?: { code?: string; message?: string } }
      | null
    throw new ApiError(
      payload?.error?.message ?? `Backend returned ${response.status}.`,
      response.status,
      payload?.error?.code,
    )
  }
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

export function register(
  email: string,
  password: string,
  ageConfirmed14: boolean,
): Promise<AuthSession> {
  return apiFetch('/api/v1/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, ageConfirmed14 }),
  })
}

export function login(email: string, password: string): Promise<AuthSession> {
  return apiFetch('/api/v1/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
}

export function getSession(): Promise<AuthSession> {
  return apiFetch('/api/v1/auth/me')
}

export function logout(): Promise<void> {
  return apiFetch('/api/v1/auth/logout', { method: 'POST' })
}

export function deleteAccount(): Promise<void> {
  return apiFetch('/api/v1/account', { method: 'DELETE' })
}

export function getBalance(): Promise<BalanceSummary> {
  return apiFetch('/api/v1/account/balance')
}

export function resolveQuestion(
  question: string,
  requestedDocuments = 5,
  filters: TargetFilters = {},
): Promise<Resolution> {
  return apiFetch('/api/v1/questions/resolve', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ question, requestedDocuments, filters }),
  })
}

export function generateAiBaseline(
  queryId: string,
  paymentAccessToken: string,
): Promise<AiBaselineResult> {
  return apiFetch(`/api/v1/questions/${encodeURIComponent(queryId)}/ai-baseline`, {
    method: 'POST',
    headers: { 'x-openshelf-query-token': paymentAccessToken },
  })
}

export function listShelfStarters(): Promise<ShelfStarter[]> {
  return apiFetch('/api/v1/shelf-starters')
}

export function generateShelfStarters(): Promise<ShelfStarterResult> {
  return apiFetch('/api/v1/shelf-starters', { method: 'POST' })
}

export function submitShelfStarterAnswer(
  starterId: string,
  answer: string,
  priceKrw: number,
): Promise<{ memory: MemoryEntry; documentHandle: string }> {
  return apiFetch(`/api/v1/shelf-starters/${encodeURIComponent(starterId)}/answer`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ answer, priceKrw }),
  })
}

type ApiOrder = Omit<Order, 'category'> & { category: string }

function orderFromApi(order: ApiOrder): Order {
  return { ...order, category: order.category as CategoryId }
}

export async function listOpenCalls(): Promise<Order[]> {
  const calls = await apiFetch<ApiOrder[]>('/api/v1/open-calls')
  return calls.map(orderFromApi)
}

export async function createOpenCall(input: {
  question: string
  unitPrice: number
  target: number
  chatId?: string
  shelf: string
  category: CategoryId
  filters?: TargetFilters
}): Promise<Order> {
  const call = await apiFetch<ApiOrder>('/api/v1/open-calls', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
  return orderFromApi(call)
}

export async function cancelOpenCall(orderId: string): Promise<Order> {
  const call = await apiFetch<ApiOrder>(
    `/api/v1/open-calls/${encodeURIComponent(orderId)}`,
    { method: 'DELETE' },
  )
  return orderFromApi(call)
}

export function getChatAnswers(chatId: string): Promise<ChatAnswer[]> {
  return apiFetch(`/api/v1/chats/${encodeURIComponent(chatId)}/answers`)
}

export function listMemory(): Promise<MemoryEntry[]> {
  return apiFetch('/api/v1/memory')
}

export function setMemoryLocked(
  memoryId: string,
  locked: boolean,
): Promise<MemoryEntry> {
  return apiFetch(`/api/v1/memory/${encodeURIComponent(memoryId)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ locked }),
  })
}

export function correctMemory(memoryId: string, answer: string): Promise<MemoryEntry> {
  return apiFetch(`/api/v1/memory/${encodeURIComponent(memoryId)}/corrections`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ answer }),
  })
}

export type MemoryExport = {
  exportedAt: number
  profile: ServerProfile | null
  memories: MemoryEntry[]
  accessLog: Array<{
    id: string
    memoryId?: string
    purpose: string
    createdAt: number
  }>
}

export function exportAccount(): Promise<MemoryExport> {
  return apiFetch('/api/v1/account/export')
}

export type EvidenceSynthesis = {
  answer: string
  confidence: number
  consensus: string[]
  disagreements: string[]
  usedHandles: string[]
  contributions: Array<{ handle: string; score: number; reason: string }>
  model: string
  mode: 'vertex' | 'gemini_api' | 'evidence_only_fallback' | string
}

export function synthesizeAnswer(
  queryId: string,
  handles: string[],
  accessToken: string,
): Promise<EvidenceSynthesis> {
  return apiFetch('/api/v1/answers/synthesize', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [QUERY_TOKEN_HEADER]: accessToken,
    },
    body: JSON.stringify({ queryId, handles }),
  })
}

export function getAccountControls(): Promise<{
  strikes: number
  disputeUsed: boolean
  suspended: boolean
}> {
  return apiFetch('/api/v1/account-controls')
}

export type ServerProfile = Profile & {
  autoMatch: boolean
  agents: boolean
  browserAlerts: boolean
  emailAlerts: boolean
  suspended: boolean
}

export type WalletChallenge = {
  id: string
  wallet: string
  message: string
  expiresAt: number
}

export function createWalletChallenge(wallet: string): Promise<WalletChallenge> {
  return apiFetch('/api/v1/profile/wallet/challenge', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ wallet }),
  })
}

export function verifyWalletChallenge(
  challengeId: string,
  signature: string,
): Promise<ServerProfile> {
  return apiFetch('/api/v1/profile/wallet/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ challengeId, signature }),
  })
}

const QUERY_TOKEN_HEADER = 'x-openshelf-query-token'

export type PaymentDocumentProgress = {
  handle: string
  priceKrw: number
  status: 'unpaid' | 'quoted' | 'settled'
  quoteId?: string
  quoteExpiresAt?: number
  transactionSignature?: string
  network?: string
  settledAt?: number
}

export type PaymentProgress = {
  queryId: string
  payer: string
  documentCount: number
  settledCount: number
  unpaidCount: number
  totalPriceKrw: number
  settledPriceKrw: number
  documents: PaymentDocumentProgress[]
}

export type ChainSettlementReceipt = {
  id: string
  quoteId: string
  transactionSignature: string
  payer: string
  payTo: string
  amountAtomic: string
  network: string
  confirmedAt: number
}

export type RecoveredPaidDocument = {
  citation: {
    handle: string
    shelf: string
    excerpt: string
    price: number
  }
  settlement: ChainSettlementReceipt
}

export function getPaymentProgress(
  queryId: string,
  payer: string,
  accessToken: string,
): Promise<PaymentProgress> {
  const params = new URLSearchParams({ payer })
  return apiFetch(
    `/api/v1/questions/${encodeURIComponent(queryId)}/payment-progress?${params}`,
    { headers: { [QUERY_TOKEN_HEADER]: accessToken } },
  )
}

export function recoverPaidDocument(
  queryId: string,
  handle: string,
  payer: string,
  accessToken: string,
): Promise<RecoveredPaidDocument> {
  const params = new URLSearchParams({ payer })
  return apiFetch(
    `/api/v1/questions/${encodeURIComponent(queryId)}/paid-documents/${encodeURIComponent(handle)}?${params}`,
    { headers: { [QUERY_TOKEN_HEADER]: accessToken } },
  )
}

export type DocumentFeedback = {
  id: string
  queryId: string
  documentHandle: string
  payer: string
  outcome: 'helpful' | 'not_helpful' | 'report'
  reason?: string
  status: 'recorded' | 'pending' | 'upheld' | 'dismissed'
  reviewNote?: string
  createdAt: number
  reviewedAt?: number
}

export function submitDocumentFeedback(
  queryId: string,
  handle: string,
  payer: string,
  accessToken: string,
  outcome: DocumentFeedback['outcome'],
  reason?: string,
): Promise<DocumentFeedback> {
  const params = new URLSearchParams({ payer })
  return apiFetch(
    `/api/v1/questions/${encodeURIComponent(queryId)}/paid-documents/${encodeURIComponent(handle)}/feedback?${params}`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [QUERY_TOKEN_HEADER]: accessToken,
      },
      body: JSON.stringify({ outcome, reason }),
    },
  )
}

export function listDocumentFeedback(): Promise<DocumentFeedback[]> {
  return apiFetch('/api/v1/admin/document-feedback')
}

export function reviewDocumentFeedback(
  feedbackId: string,
  decision: 'upheld' | 'dismissed',
  note: string,
): Promise<DocumentFeedback> {
  return apiFetch(
    `/api/v1/admin/document-feedback/${encodeURIComponent(feedbackId)}/review`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision, note }),
    },
  )
}

export function getProfile(): Promise<ServerProfile | null> {
  return apiFetch('/api/v1/profile')
}

export function upsertProfile(
  profile: Omit<Profile, 'strikes' | 'disputeUsed' | 'agreedAt'>,
  preferences: {
    autoMatch: boolean
    agents: boolean
    browserAlerts?: boolean
    emailAlerts?: boolean
  },
): Promise<ServerProfile> {
  return apiFetch('/api/v1/profile', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...profile, ...preferences }),
  })
}

export function updatePreferences(preferences: {
  autoMatch?: boolean
  agents?: boolean
  browserAlerts?: boolean
  emailAlerts?: boolean
}): Promise<ServerProfile> {
  return apiFetch('/api/v1/profile/preferences', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(preferences),
  })
}

export type EarningEvent = {
  id: string
  settlementId?: string
  memoryId?: string
  documentHandle?: string
  source: 'seed' | 'open_call' | 'dispute_restored' | 'document_open' | 'document_open_bundle'
  amountKrw: number
  recipientWallet?: string
  payoutStatus: 'accrued' | 'held' | 'onchain' | 'claimable'
  availableAt: number
  createdAt: number
}

export type EarningsSummary = {
  accruedKrw: number
  heldKrw: number
  availableKrw: number
  claimableKrw: number
  eventCount: number
  events: EarningEvent[]
}

export function getEarnings(): Promise<EarningsSummary> {
  return apiFetch('/api/v1/earnings')
}

export type SubmitAnswerResult = {
  order: Order
  memory: MemoryEntry
  issues: Issue[]
}

type ApiSubmitAnswerResult = Omit<SubmitAnswerResult, 'order'> & {
  order: ApiOrder
}

export async function submitAnswer(
  orderId: string,
  answer: string,
  interviewResponses: InterviewResponse[] = [],
): Promise<SubmitAnswerResult> {
  const result = await apiFetch<ApiSubmitAnswerResult>(
    `/api/v1/open-calls/${encodeURIComponent(orderId)}/answers`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ answer, interviewResponses }),
    },
  )
  return { ...result, order: orderFromApi(result.order) }
}

export type OpenCallReservation = {
  openCallId: string
  expiresAt: number
}

export function reserveOpenCall(orderId: string): Promise<OpenCallReservation> {
  return apiFetch(
    `/api/v1/open-calls/${encodeURIComponent(orderId)}/reservation`,
    { method: 'POST' },
  )
}

export function releaseOpenCallReservation(orderId: string): Promise<void> {
  return apiFetch(
    `/api/v1/open-calls/${encodeURIComponent(orderId)}/reservation/release`,
    { method: 'POST', keepalive: true },
  )
}

export function beaconReleaseOpenCallReservation(orderId: string): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.sendBeacon !== 'function') {
    return false
  }
  return navigator.sendBeacon(
    `${API_BASE}/api/v1/open-calls/${encodeURIComponent(orderId)}/reservation/release`,
  )
}

export type ContributorNotification = {
  id: string
  kind: 'call_available' | 'auto_matched' | 'answer_received' | 'call_filled' | string
  title: string
  body: string
  openCallId?: string
  createdAt: number
  readAt?: number
}

export function listNotifications(): Promise<ContributorNotification[]> {
  return apiFetch('/api/v1/notifications')
}

export function markNotificationsRead(ids: string[] = []): Promise<void> {
  return apiFetch('/api/v1/notifications/read', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ids }),
  })
}

export function disputeMemory(
  memoryId: string,
  reason: string,
): Promise<DisputeCase> {
  return apiFetch(`/api/v1/memory/${encodeURIComponent(memoryId)}/dispute`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reason }),
  })
}

export function listDisputes(): Promise<DisputeCase[]> {
  return apiFetch('/api/v1/admin/disputes')
}

export function reviewDispute(
  memoryId: string,
  decision: 'approved' | 'rejected',
  note: string,
): Promise<DisputeCase> {
  return apiFetch(
    `/api/v1/admin/disputes/${encodeURIComponent(memoryId)}/review`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision, note }),
    },
  )
}
