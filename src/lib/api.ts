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
  decision: 'hit' | 'miss'
  reason:
    | 'coverage_ready'
    | 'no_relevant_documents'
    | 'insufficient_coverage'
    | 'budget_too_low'
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

export function register(email: string, password: string): Promise<AuthSession> {
  return apiFetch('/api/v1/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
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
  suspended: boolean
}

export function getProfile(): Promise<ServerProfile | null> {
  return apiFetch('/api/v1/profile')
}

export function upsertProfile(
  profile: Omit<Profile, 'strikes' | 'disputeUsed' | 'agreedAt'>,
  preferences: { autoMatch: boolean; agents: boolean },
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
  source: 'seed' | 'open_call' | 'dispute_restored' | 'document_open'
  amountKrw: number
  recipientWallet?: string
  payoutStatus: 'accrued' | 'held' | 'onchain'
  availableAt: number
  createdAt: number
}

export type EarningsSummary = {
  accruedKrw: number
  heldKrw: number
  availableKrw: number
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
