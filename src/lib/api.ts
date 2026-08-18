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
  agentRun?: {
    id: string
    objective: string
    model: string
    mode: string
    providerCallCount: number
    runtimeRevision?: string
    nextAction:
      | 'search_human_evidence'
      | 'rank_evidence_bundle'
      | 'propose_evidence_purchase'
      | 'propose_hybrid_research'
      | 'propose_open_call'
      | 'generate_general_baseline'
      | 'finish_without_purchase'
    requiresUserApproval: boolean
    steps: Array<{
      sequence: number
      agent: string
      tool: string
      status: 'completed' | 'fallback' | 'awaiting_user_approval'
      summary: string
      artifactRef?: string
    }>
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
  wallet?: string | null
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
      'Obolus is temporarily unavailable. Check your connection and try again.',
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

/**
 * `wallet_login_v1` only ever proves wallet ownership for sign-in;
 * `prepaid_spend_v1` only ever authorizes issuing a bounded, expiring
 * prepaid-spend capability. The server rejects a challenge at every
 * consuming endpoint unless its stored purpose matches that endpoint,
 * regardless of what the client claims here. See GitHub issue #46.
 */
export type WalletChallengePurpose = 'wallet_login_v1' | 'prepaid_spend_v1'

export type WalletAuthChallenge = {
  id: string
  wallet: string
  message: string
  purpose: WalletChallengePurpose
  expiresAt: number
}

export function createWalletAuthChallenge(
  wallet: string,
  purpose: WalletChallengePurpose,
): Promise<WalletAuthChallenge> {
  return apiFetch('/api/v1/auth/wallet/challenge', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ wallet, purpose }),
  })
}

export function verifyWalletAuth(
  wallet: string,
  challengeId: string,
  signature: string,
  ageConfirmed14: boolean,
): Promise<AuthSession> {
  return apiFetch('/api/v1/auth/wallet/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ wallet, challengeId, signature, ageConfirmed14 }),
  })
}

export function getSession(): Promise<AuthSession> {
  return apiFetch('/api/v1/auth/me')
}

export function logout(): Promise<void> {
  return apiFetch('/api/v1/auth/logout', { method: 'POST' })
}

export function forgotPassword(email: string): Promise<void> {
  return apiFetch('/api/v1/auth/password/forgot', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email }),
  })
}

export function resetPassword(token: string, password: string): Promise<void> {
  return apiFetch('/api/v1/auth/password/reset', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token, password }),
  })
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

export type CreateOpenCallInput = {
  question: string
  unitPrice: number
  target: number
  chatId?: string
  shelf: string
  category: CategoryId
  filters?: TargetFilters
}

export type OpenCallFundingQuote = {
  id: string
  payTo: string
  network: string
  asset: string
  amountAtomic: string
  totalPriceKrw: number
  krwPerUsdc: number
  expiresAt: number
  resourcePath: string
  payloadHash: string
  status: 'quoted' | 'settling' | 'funded' | 'expired'
  openCallId?: string | null
}

export async function createOpenCall(input: CreateOpenCallInput): Promise<Order> {
  const call = await apiFetch<ApiOrder>('/api/v1/open-calls', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
  return orderFromApi(call)
}

export function prepareOpenCallFundingQuote(
  input: CreateOpenCallInput,
): Promise<OpenCallFundingQuote> {
  return apiFetch('/api/v1/open-call-funding-quotes', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export function getOpenCallFundingQuote(quoteId: string): Promise<OpenCallFundingQuote> {
  return apiFetch(`/api/v1/open-call-funding-quotes/${encodeURIComponent(quoteId)}`)
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

export type PrepaidWalletSession = {
  token: string
  wallet: string
  payTo: string
  network: string
  asset: string
  availableAtomic: string
  expiresAt: number
}

export type PrepaidBalance = Omit<PrepaidWalletSession, 'token' | 'expiresAt'>

export type PaymentBundleQuote = {
  id: string
  queryId: string
  documentHandles: string[]
  payTo: string
  network: string
  asset: string
  amountAtomic: string
  budgetAtomic: string
  minimumDepositAtomic: string
  requiresPayment: boolean
  availableBalanceAtomic: string
  totalPriceKrw: number
  krwPerUsdc: number
  expiresAt: number
  resourcePath: string
  bundleHash: string
  status: string
}

export function createPrepaidWalletSession(
  wallet: string,
  challengeId: string,
  signature: string,
): Promise<PrepaidWalletSession> {
  return apiFetch('/api/v1/prepaid/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ wallet, challengeId, signature }),
  })
}

export function getPrepaidBalance(): Promise<PrepaidBalance> {
  return apiFetch('/api/v1/prepaid/balance')
}

export type PrepaidDepositReceipt = {
  id: string
  wallet: string
  amountAtomic: string
  availableAtomic: string
  transactionSignature?: string
}

/**
 * Standalone prepaid top-up credit.
 *
 * Drop-in client for a backend route that does NOT exist yet:
 * `POST /api/v1/prepaid/deposits`. Today every credit to
 * `prepaid_accounts.available_atomic` is welded to a payment-bundle purchase
 * (credit_prepaid_deposit is only reachable from bundle settlement, which also
 * reserves a research budget). A standalone "add N USDC, buy nothing" deposit
 * needs a route that verifies a settled USDC transfer to the prepaid `payTo`
 * and calls `credit_prepaid_deposit` WITHOUT the following
 * `reserve_prepaid_budget`. Until that route ships, `depositPrepaidAtomic` in
 * x402.ts is gated off and this is never called.
 */
export function creditPrepaidDeposit(
  walletSessionToken: string,
  amountAtomic: string,
  transactionSignature?: string,
): Promise<PrepaidDepositReceipt> {
  return apiFetch('/api/v1/prepaid/deposits', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-openshelf-wallet-session': walletSessionToken,
    },
    body: JSON.stringify({ amountAtomic, transactionSignature }),
  })
}

export function getPaymentBundleQuote(
  quoteId: string,
  queryAccessToken: string,
  walletSessionToken: string,
): Promise<PaymentBundleQuote> {
  return apiFetch(`/api/v1/payment-bundles/${encodeURIComponent(quoteId)}`, {
    headers: {
      'x-openshelf-query-token': queryAccessToken,
      'x-openshelf-wallet-session': walletSessionToken,
    },
  })
}

export function withdrawPrepaidBalance(amountAtomic?: string): Promise<{
  id: string
  status: string
  amountAtomic: string
  recipientWallet: string
}> {
  return apiFetch('/api/v1/prepaid/withdrawals', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ amountAtomic }),
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

export type OperationsStatusCount = {
  status: string
  count: number
}

export type AdminOperationsSnapshot = {
  generatedAt: number
  marketplace: {
    humanDocuments: number
    independentContributors: number
    openCalls: number
    filledCalls: number
    pendingDisputes: number
    pendingDocumentReports: number
  }
  settlements: {
    paymentQuotes: OperationsStatusCount[]
    researchJobs: OperationsStatusCount[]
    researchPaymentAttempts: OperationsStatusCount[]
    directPaymentAttempts: OperationsStatusCount[]
    payoutClaims: OperationsStatusCount[]
    unresolvedPaymentAttempts: number
    oldestUnresolvedPaymentAt: number | null
  }
  aiLiquidity: {
    totalQueries: number
    aiLiquidityOnlyQueries: number
    hybridCoverageQueries: number
    humanCoveredQueries: number
    baselinesGenerated: number
    activeBaselines: number
    shelfStartersGenerated: number
    shelfStartersAnswered: number
    humanDocuments: number
    openHumanCalls: number
    pricedAiDocuments: number
    aiAuthorityEdges: number
    starterToHumanDocumentRate: number
  }
}

export function getAdminOperations(): Promise<AdminOperationsSnapshot> {
  return apiFetch('/api/v1/admin/operations')
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
  payoutStatus: 'accrued' | 'held' | 'onchain' | 'claimable' | 'paid'
  payoutClaimId?: string
  payoutClaimStatus?: 'pending' | 'leased' | 'prepared' | 'failed' | 'confirmed' | string
  payoutTransactionSignature?: string
  payoutAmountAtomic?: string
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
