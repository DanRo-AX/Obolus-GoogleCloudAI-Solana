import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { categoryFor, type CategoryId } from '@/data/categories'
import { STRIKE_LIMIT } from '@/data/onboarding'
import {
  BACKEND_ENABLED,
  cancelOpenCall,
  createOpenCall,
  createWalletChallenge,
  deleteAccount,
  disputeMemory,
  getBalance,
  getEarnings,
  getProfile,
  getSession,
  listMemory,
  listNotifications,
  listOpenCalls,
  logout,
  markNotificationsRead as markNotificationsReadApi,
  submitAnswer,
  updatePreferences,
  upsertProfile,
  verifyWalletAuth,
  verifyWalletChallenge,
  type EarningsSummary,
  type AiBaseline,
  type Account,
  type BalanceSummary,
  type DemographicBands,
  type ContributorNotification,
  type ServerProfile,
  type TargetFilters,
} from '@/lib/api'
import type { Issue } from '@/lib/quality'
import { fundOpenCall, X402_ENABLED } from '@/lib/x402'

/** One quoted MD. Once the open is confirmed it becomes the settlement unit. */
export type Citation = {
  handle: string
  shelf: string
  excerpt: string
  price: number
  demographics?: DemographicBands
}

export type PaymentContext = {
  queryId: string
  accessToken: string
  payer: string
}

export type PaymentSession = {
  queryId: string
  accessToken: string
  payer?: string
  docs: Citation[]
  shelfName: string
}

export type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  /** HTML for pre-baked answers (the landing trial replay). */
  html?: string
  streaming?: boolean
  citations?: Citation[]
  /** The x402 settlement line under an answer. */
  settlement?: {
    count: number
    total: number
    /** Present once a real on-chain settlement happened. */
    txSig?: string
    /** One x402/SVM settlement per opened document. */
    txSigs?: string[]
    network?: string
    partial?: boolean
    mode?: 'direct' | 'bundle_escrow' | 'open_call_escrow' | 'pay_sh_direct' | 'pay_sh_orchestrated'
  }
  /** Kept privately in local chat state so a paid buyer can recover and rate. */
  paymentContext?: PaymentContext
}

export type Chat = {
  id: string
  title: string
  createdAt: number
  messages: ChatMessage[]
  filters?: TargetFilters
  ownerId?: string
  paymentSession?: PaymentSession
  /** Ephemeral zero-price context; never a citation, memory, or shelf asset. */
  aiBaseline?: AiBaseline
}

/** An open call. Posted on the spot when the shelves come up empty. */
export type Order = {
  id: string
  question: string
  unitPrice: number
  target: number
  answered: number
  createdAt: number
  /** The chat that placed it. Answers come back here. */
  chatId?: string
  /** Mine, or someone else's. */
  mine: boolean
  shelf: string
  /** Broad field, for the dashboard tabs. Derived when a caller omits it. */
  category: CategoryId
  filters?: TargetFilters
  eligible?: boolean
  escrowRemainingKrw?: number
  escrowMode?: 'sandbox' | 'x402_solana_escrow'
  escrowWallet?: string
  escrowAsset?: string
  escrowNetwork?: string
  escrowTotalAtomic?: string
  escrowRemainingAtomic?: string
  fundingTransactionSignature?: string
  status?: 'open' | 'filled' | 'cancelled'
  reservedSlots?: number
  reservationExpiresAt?: number
  recommendationScore?: number
  recommendationReason?: string[]
}

/**
 * What a buyer knows about the person behind a passage.
 *
 * Bands, never values — "35–44 · Seoul · with kids at home" is enough to judge
 * whether an answer about first-grade costs came from someone who paid them.
 * Nothing here is financial and nothing identifies a person.
 */
export type Profile = {
  handle: string
  ageBand: string
  region: string
  household: string
  /** Their own line of work. */
  field: CategoryId
  years: string
  /** Fields they agreed to take calls in. This is the matching key. */
  speaksTo: CategoryId[]
  /** Conduct strikes. Three suspends the account. */
  strikes: number
  /** One dispute per account, as promised on the way in. */
  disputeUsed: boolean
  /** Solana pubkey payouts land at. Optional — you can connect later. */
  wallet?: string
  walletVerified?: boolean
  walletVerifiedAt?: number
  agreedAt: number
  browserAlerts?: boolean
  emailAlerts?: boolean
}

/** One line of the memory stream. Recent entries carry more weight. */
export type InterviewResponse = {
  questionId: string
  prompt: string
  answer: string
}

export type MemoryEntry = {
  id: string
  question: string
  answer: string
  shelf: string
  earned: number
  createdAt: number
  via: 'Open call' | 'Auto-match' | 'Shelf starter' | 'Correction' | 'Reflection'
  /** Voided entries keep the attempted answer but earn zero until disputed. */
  status: 'settled' | 'voided'
  disputeStatus?: 'pending' | 'approved' | 'rejected'
  /** Which rules the answer tripped, if any. */
  flags?: Issue[]
  /** Buyer rating out of 5, once someone has opened it. */
  rating?: number
  /** Private warm-up context. It is retained but never indexed or sold. */
  interviewResponses?: InterviewResponse[]
  memoryType?: 'observation' | 'reflection' | 'correction'
  importance?: number
  reliabilityScore?: number
  contentHash?: string
  version?: number
  locked?: boolean
  accessCount?: number
  lastAccessedAt?: number
  sourceIds?: string[]
}

type UiValue = {
  collapsed: boolean
  setCollapsed: (v: boolean) => void
  agents: boolean
  setAgents: (v: boolean) => void
  autoMatch: boolean
  setAutoMatch: (v: boolean) => void
  setBrowserAlerts: (v: boolean) => Promise<void>
  setEmailAlerts: (v: boolean) => Promise<void>
  mobileSidebar: boolean
  setMobileSidebar: (v: boolean) => void
  chats: Chat[]
  orders: Order[]
  memory: MemoryEntry[]
  earnings: EarningsSummary | null
  notifications: ContributorNotification[]
  markNotificationsRead: (ids?: string[]) => Promise<void>
  balance: BalanceSummary | null
  account: Account | null
  authWallet: string | null
  authReady: boolean
  /** null until an authenticated account completes onboarding. */
  profile: Profile | null
  saveProfile: (
    p: Omit<Profile, 'strikes' | 'disputeUsed' | 'agreedAt'>,
  ) => Promise<void>
  verifyPayoutWallet: (
    wallet: string,
    signMessage: (message: string) => Promise<string>,
  ) => Promise<void>
  authenticateWallet: (
    wallet: string,
    challengeId: string,
    signature: string,
    ageConfirmed14: boolean,
  ) => Promise<void>
  signOut: () => Promise<void>
  deleteCurrentAccount: () => Promise<void>
  /** Three strikes. Set once the ladder runs out. */
  suspended: boolean
  /** Spend the one dispute on a voided answer: strike lifted, payment restored. */
  disputeStrike: (memoryId: string, reason: string) => Promise<void>
  refreshLedger: () => Promise<void>
  createChat: (prompt: string, filters?: TargetFilters) => string
  patchChat: (chatId: string, patch: Partial<Chat>) => void
  appendAssistant: (chatId: string, message: ChatMessage) => void
  patchMessage: (
    chatId: string,
    messageId: string,
    patch: Partial<ChatMessage>,
  ) => void
  placeOrder: (
    order: Omit<Order, 'id' | 'createdAt' | 'answered' | 'category'> & {
      category?: CategoryId
    },
  ) => Promise<string>
  answerOrder: (
    orderId: string,
    answer: string,
    flags?: Issue[],
    interviewResponses?: InterviewResponse[],
  ) => Promise<{ voided: boolean; issues: Issue[] }>
  cancelOrder: (orderId: string) => Promise<void>
  clearAll: () => void
}

const UiContext = createContext<UiValue | null>(null)
const STORAGE_KEY = 'openshelf:v1'
const SESSION_STORAGE_KEY = 'openshelf:session:v1'

type Persisted = {
  chats: Chat[]
  orders: Order[]
  memory: MemoryEntry[]
  profile: Profile | null
  agents: boolean
  autoMatch: boolean
}

/** Entries stored before answers could be voided default to settled. */
function normaliseMemory(memory: MemoryEntry[]): MemoryEntry[] {
  return memory.map((m) => (m.status ? m : { ...m, status: 'settled' as const }))
}

/** Orders stored before the taxonomy existed get a category on the way in. */
function normalise(orders: Order[]): Order[] {
  return orders.map((o) =>
    o.category ? o : { ...o, category: categoryFor(o.shelf, o.question) },
  )
}

function profileFromServer(profile: ServerProfile): Profile {
  return {
    handle: profile.handle,
    ageBand: profile.ageBand,
    region: profile.region,
    household: profile.household,
    field: profile.field,
    years: profile.years,
    speaksTo: profile.speaksTo,
    strikes: profile.strikes,
    disputeUsed: profile.disputeUsed,
    wallet: profile.wallet,
    walletVerified: profile.walletVerified,
    walletVerifiedAt: profile.walletVerifiedAt,
    agreedAt: profile.agreedAt,
    browserAlerts: profile.browserAlerts,
    emailAlerts: profile.emailAlerts,
  }
}

function load(): Persisted {
  const fallback: Persisted = {
    chats: [],
    orders: [],
    memory: [],
    profile: null,
    agents: false,
    autoMatch: true,
  }
  if (typeof window === 'undefined') return fallback
  try {
    // Server-backed chats contain paid passages and query capabilities. Keep
    // them only for the current browser session, and remove the legacy durable
    // copy left by earlier builds.
    if (BACKEND_ENABLED) window.localStorage.removeItem(STORAGE_KEY)
    const storage = BACKEND_ENABLED ? window.sessionStorage : window.localStorage
    const key = BACKEND_ENABLED ? SESSION_STORAGE_KEY : STORAGE_KEY
    const raw = storage.getItem(key)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as Partial<Persisted>
    return {
      chats: parsed.chats ?? [],
      orders: parsed.orders
        ? normalise(parsed.orders)
        : [],
      memory: parsed.memory
        ? normaliseMemory(parsed.memory)
        : [],
      profile: parsed.profile ?? null,
      agents: parsed.agents ?? false,
      autoMatch: parsed.autoMatch ?? true,
    }
  } catch {
    return fallback
  }
}

export function UiProvider({ children }: { children: React.ReactNode }) {
  const initial = useMemo(load, [])
  const [collapsed, setCollapsed] = useState(false)
  const [mobileSidebar, setMobileSidebar] = useState(false)
  const [agents, setAgentsState] = useState(initial.agents)
  const [autoMatch, setAutoMatchState] = useState(initial.autoMatch)
  const [chats, setChats] = useState<Chat[]>(initial.chats)
  const [orders, setOrders] = useState<Order[]>(initial.orders)
  const [memory, setMemory] = useState<MemoryEntry[]>(initial.memory)
  const [earnings, setEarnings] = useState<EarningsSummary | null>(null)
  const [notifications, setNotifications] = useState<ContributorNotification[]>([])
  const notifiedIds = useRef(new Set<string>())
  const [profile, setProfile] = useState<Profile | null>(
    BACKEND_ENABLED ? null : initial.profile,
  )
  const [account, setAccount] = useState<Account | null>(null)
  const [authWallet, setAuthWallet] = useState<string | null>(null)
  const [balance, setBalance] = useState<BalanceSummary | null>(null)
  const [authReady, setAuthReady] = useState(!BACKEND_ENABLED)

  useEffect(() => {
    try {
      const storage = BACKEND_ENABLED ? window.sessionStorage : window.localStorage
      storage.setItem(
        BACKEND_ENABLED ? SESSION_STORAGE_KEY : STORAGE_KEY,
        JSON.stringify({ chats, orders, memory, profile, agents, autoMatch }),
      )
    } catch {
      /* storage disabled — the app still works, it just won't persist */
    }
  }, [chats, orders, memory, profile, agents, autoMatch])

  useEffect(() => {
    if (!BACKEND_ENABLED) return
    let cancelled = false
    void (async () => {
      try {
        const remoteOrders = await listOpenCalls()
        if (cancelled) return
        setOrders(remoteOrders)
        const session = await getSession().catch(() => null)
        if (cancelled) return
        if (!session) {
          setAccount(null)
          setChats((current) => current.filter((chat) => !chat.ownerId))
          setMemory([])
          setProfile(null)
          setEarnings(null)
          setNotifications([])
          setBalance(null)
          setAuthWallet(null)
          return
        }
        const [remoteMemory, remoteProfile, remoteEarnings, remoteNotifications] = await Promise.all([
          listMemory(),
          getProfile(),
          getEarnings(),
          listNotifications(),
        ])
        if (cancelled) return
        setAccount(session.user)
        setAuthWallet(session.wallet ?? null)
        setChats((current) =>
          current
            .filter(
              (chat) => !chat.ownerId || chat.ownerId === session.user.id,
            )
            .map((chat) =>
              chat.ownerId ? chat : { ...chat, ownerId: session.user.id },
            ),
        )
        setBalance(session.balance)
        setMemory(remoteMemory)
        setEarnings(remoteEarnings)
        setNotifications(remoteNotifications)
        remoteNotifications.forEach((notification) => notifiedIds.current.add(notification.id))
        if (remoteProfile) {
          setProfile(profileFromServer(remoteProfile))
          setAutoMatchState(remoteProfile.autoMatch)
          setAgentsState(remoteProfile.agents)
        }
      } catch {
        // Chat surfaces backend connectivity errors when a request is made.
        // Public surfaces still render, but private state is never fabricated.
      } finally {
        if (!cancelled) setAuthReady(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!BACKEND_ENABLED || !account) return
    let cancelled = false
    const collect = async () => {
      const [remoteNotifications, remoteOrders] = await Promise.all([
        listNotifications(),
        listOpenCalls(),
      ])
      if (cancelled) return
      const fresh = remoteNotifications.filter(
        (notification) =>
          !notification.readAt && !notifiedIds.current.has(notification.id),
      )
      remoteNotifications.forEach((notification) =>
        notifiedIds.current.add(notification.id),
      )
      setNotifications(remoteNotifications)
      setOrders(remoteOrders)
      if (
        profile?.browserAlerts !== false &&
        typeof Notification !== 'undefined' &&
        Notification.permission === 'granted'
      ) {
        for (const item of fresh.slice(0, 3)) {
          const alert = new Notification(item.title, { body: item.body })
          alert.onclick = () => {
            window.focus()
            window.location.assign(
              item.openCallId ? `/answer/${item.openCallId}` : '/dashboard',
            )
          }
        }
      }
    }
    void collect().catch(() => undefined)
    const interval = window.setInterval(
      () => void collect().catch(() => undefined),
      5_000,
    )
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [account, profile?.browserAlerts])

  const refreshLedger = useCallback(async () => {
    if (!BACKEND_ENABLED) return
    const [remoteMemory, remoteEarnings, remoteBalance, remoteOrders, remoteNotifications] = await Promise.all([
      listMemory(),
      getEarnings(),
      getBalance(),
      listOpenCalls(),
      listNotifications(),
    ])
    setMemory(remoteMemory)
    setEarnings(remoteEarnings)
    setBalance(remoteBalance)
    setOrders(remoteOrders)
    setNotifications(remoteNotifications)
  }, [])

  const createChat = useCallback((prompt: string, filters?: TargetFilters) => {
    const id = `c_${Date.now().toString(36)}${Math.random()
      .toString(36)
      .slice(2, 6)}`
    const title = prompt.trim().slice(0, 60) || 'New question'
    setChats((prev) => [
      {
        id,
        title,
        createdAt: Date.now(),
        filters,
        ownerId: account?.id,
        messages: [{ id: `${id}_u`, role: 'user', content: prompt.trim() }],
      },
      ...prev,
    ])
    return id
  }, [account?.id])

  const appendAssistant = useCallback((chatId: string, message: ChatMessage) => {
    setChats((prev) =>
      prev.map((c) =>
        c.id === chatId ? { ...c, messages: [...c.messages, message] } : c,
      ),
    )
  }, [])

  const patchChat = useCallback((chatId: string, patch: Partial<Chat>) => {
    setChats((prev) =>
      prev.map((chat) => (chat.id === chatId ? { ...chat, ...patch } : chat)),
    )
  }, [])

  const patchMessage = useCallback(
    (chatId: string, messageId: string, patch: Partial<ChatMessage>) => {
      setChats((prev) =>
        prev.map((c) =>
          c.id === chatId
            ? {
                ...c,
                messages: c.messages.map((m) =>
                  m.id === messageId ? { ...m, ...patch } : m,
                ),
              }
            : c,
        ),
      )
    },
    [],
  )

  const placeOrder = useCallback(
    async (
      order: Omit<Order, 'id' | 'createdAt' | 'answered' | 'category'> & {
        category?: CategoryId
      },
    ) => {
      // An explicit respondent field is a stronger signal than the lightweight
      // keyword classifier. Keeping both aligned avoids impossible-looking
      // combinations such as `category life · field travel` on the board.
      const category =
        order.category ??
        order.filters?.field ??
        categoryFor(order.shelf, order.question)
      if (BACKEND_ENABLED) {
        const input = {
          question: order.question,
          unitPrice: order.unitPrice,
          target: order.target,
          chatId: order.chatId,
          shelf: order.shelf,
          category,
          filters: order.filters,
        }
        // Zero-price calls have no token transfer to settle. Paid calls use one
        // exact Devnet escrow approval for the whole target, then fan out via
        // durable payout claims as answers arrive.
        const created = X402_ENABLED && order.unitPrice > 0
          ? await fundOpenCall(input)
          : await createOpenCall(input)
        setOrders((prev) => [created, ...prev.filter((item) => item.id !== created.id)])
        setBalance(await getBalance())
        return created.id
      }

      const id = `o_${Date.now().toString(36)}${Math.random()
        .toString(36)
        .slice(2, 5)}`
      setOrders((prev) => [
        {
          ...order,
          category,
          id,
          createdAt: Date.now(),
          answered: 0,
        },
        ...prev,
      ])
      return id
    },
    [],
  )

  /**
   * Answer an open call. The answer lands in the memory stream as-is.
   *
   * Calling another setState inside a setState updater double-writes under
   * StrictMode, which duplicated memory entries. The lookup happens outside so
   * both updaters stay pure.
   */
  const answerOrder = useCallback(
    async (
      orderId: string,
      answer: string,
      flags?: Issue[],
      interviewResponses?: InterviewResponse[],
    ) => {
      const order = orders.find((o) => o.id === orderId)
      if (!order || order.answered >= order.target) {
        return { voided: false, issues: [] }
      }

      if (BACKEND_ENABLED) {
        const result = await submitAnswer(orderId, answer, interviewResponses)
        setOrders((prev) =>
          prev.map((item) => (item.id === orderId ? result.order : item)),
        )
        setMemory((prev) => [
          result.memory,
          ...prev.filter((item) => item.id !== result.memory.id),
        ])
        if (result.issues.length) {
          setProfile((p) =>
            p ? { ...p, strikes: Math.min(STRIKE_LIMIT, p.strikes + 1) } : p,
          )
        }
        void Promise.all([getEarnings(), getProfile(), getBalance()])
          .then(([remoteEarnings, remoteProfile, remoteBalance]) => {
            setEarnings(remoteEarnings)
            setBalance(remoteBalance)
            if (!remoteProfile) return
            setProfile(profileFromServer(remoteProfile))
            setAutoMatchState(remoteProfile.autoMatch)
          })
          .catch(() => undefined)
        return { voided: result.issues.length > 0, issues: result.issues }
      }

      const voided = Boolean(flags?.length)

      // A voided answer does not fill a slot. The buyer never got one.
      if (!voided) {
        setOrders((prev) =>
          prev.map((o) =>
            o.id === orderId
              ? { ...o, answered: Math.min(o.target, o.answered + 1) }
              : o,
          ),
        )
      }
      setMemory((prev) => [
        {
          id: `m_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
          question: order.question,
          answer,
          shelf: order.shelf,
          earned: voided ? 0 : order.unitPrice,
          createdAt: Date.now(),
          via: 'Open call' as const,
          status: voided ? ('voided' as const) : ('settled' as const),
          flags,
          interviewResponses,
        },
        ...prev,
      ])
      if (voided) {
        setProfile((p) =>
          p ? { ...p, strikes: Math.min(STRIKE_LIMIT, p.strikes + 1) } : p,
        )
      }
      return { voided, issues: flags ?? [] }
    },
    [orders],
  )

  /**
   * The one dispute creates a review case. A reviewer—not the submitter—decides
   * whether the strike, document, and escrow payment are restored.
   */
  const disputeStrike = useCallback(async (memoryId: string, reason: string) => {
    if (BACKEND_ENABLED) {
      const dispute = await disputeMemory(memoryId, reason)
      setMemory((prev) =>
        prev.map((entry) =>
          entry.id === memoryId
            ? { ...entry, disputeStatus: dispute.status }
            : entry,
        ),
      )
      setProfile((p) =>
        p && !p.disputeUsed
          ? { ...p, disputeUsed: true }
          : p,
      )
      return
    }
    setMemory((prev) =>
      prev.map((m) =>
        m.id === memoryId ? { ...m, status: 'settled' as const } : m,
      ),
    )
    setProfile((p) =>
      p && !p.disputeUsed
        ? { ...p, strikes: Math.max(0, p.strikes - 1), disputeUsed: true }
        : p,
    )
  }, [])

  /**
   * Completing onboarding persists the profile and conduct agreement.
   */
  const setAgents = useCallback(
    (value: boolean) => {
      const previous = agents
      setAgentsState(value)
      if (!BACKEND_ENABLED || !profile) return
      void updatePreferences({ agents: value })
        .then((updated) => {
          setProfile(profileFromServer(updated))
          setAgentsState(updated.agents)
        })
        .catch(() => setAgentsState(previous))
    },
    [agents, profile],
  )

  const setAutoMatch = useCallback(
    (value: boolean) => {
      const previous = autoMatch
      setAutoMatchState(value)
      if (!BACKEND_ENABLED || !profile) return
      void updatePreferences({ autoMatch: value })
        .then((updated) => {
          setProfile(profileFromServer(updated))
          setAutoMatchState(updated.autoMatch)
        })
        .catch(() => setAutoMatchState(previous))
    },
    [autoMatch, profile],
  )

  const setBrowserAlerts = useCallback(
    async (value: boolean) => {
      if (!profile) return
      let enabled = value
      if (value) {
        if (typeof Notification === 'undefined') {
          throw new Error('This browser does not support system notifications.')
        }
        const permission =
          Notification.permission === 'granted'
            ? 'granted'
            : await Notification.requestPermission()
        enabled = permission === 'granted'
        if (!enabled) {
          throw new Error('Browser notification permission was not granted.')
        }
      }
      if (BACKEND_ENABLED) {
        const updated = await updatePreferences({ browserAlerts: enabled })
        setProfile(profileFromServer(updated))
      } else {
        setProfile((current) => current ? { ...current, browserAlerts: enabled } : current)
      }
    },
    [profile],
  )

  const setEmailAlerts = useCallback(
    async (value: boolean) => {
      if (!profile) return
      if (BACKEND_ENABLED) {
        const updated = await updatePreferences({ emailAlerts: value })
        setProfile(profileFromServer(updated))
      } else {
        setProfile((current) => current ? { ...current, emailAlerts: value } : current)
      }
    },
    [profile],
  )

  const markNotificationsRead = useCallback(async (ids: string[] = []) => {
    if (BACKEND_ENABLED) await markNotificationsReadApi(ids)
    const readAt = Date.now()
    setNotifications((current) =>
      current.map((notification) =>
        ids.length === 0 || ids.includes(notification.id)
          ? { ...notification, readAt: notification.readAt ?? readAt }
          : notification,
      ),
    )
  }, [])

  const saveProfile = useCallback(
    async (p: Omit<Profile, 'strikes' | 'disputeUsed' | 'agreedAt'>) => {
      if (BACKEND_ENABLED) {
        const saved = await upsertProfile(p, {
          autoMatch,
          agents,
          browserAlerts: p.browserAlerts ?? false,
          emailAlerts: p.emailAlerts ?? false,
        })
        setProfile(profileFromServer(saved))
        setAutoMatchState(saved.autoMatch)
        setAgentsState(saved.agents)
        const refreshedOrders = await listOpenCalls().catch(() => null)
        if (refreshedOrders) setOrders(refreshedOrders)
        return
      }
      setProfile({ ...p, strikes: 0, disputeUsed: false, agreedAt: Date.now() })
    },
    [agents, autoMatch],
  )

  const verifyPayoutWallet = useCallback(
    async (
      wallet: string,
      signMessage: (message: string) => Promise<string>,
    ) => {
      if (!profile) throw new Error('Complete onboarding before verifying a wallet.')
      let serverProfile = await upsertProfile(
        {
          handle: profile.handle,
          ageBand: profile.ageBand,
          region: profile.region,
          household: profile.household,
          field: profile.field,
          years: profile.years,
          speaksTo: profile.speaksTo,
          wallet,
        },
        {
          autoMatch,
          agents,
          browserAlerts: profile.browserAlerts ?? false,
          emailAlerts: profile.emailAlerts ?? false,
        },
      )
      setProfile(profileFromServer(serverProfile))
      const challenge = await createWalletChallenge(wallet)
      const signature = await signMessage(challenge.message)
      serverProfile = await verifyWalletChallenge(challenge.id, signature)
      setProfile(profileFromServer(serverProfile))
    },
    [agents, autoMatch, profile],
  )

  const authenticateWallet = useCallback(
    async (
      wallet: string,
      challengeId: string,
      signature: string,
      ageConfirmed14: boolean,
    ) => {
      const session = await verifyWalletAuth(
        wallet,
        challengeId,
        signature,
        ageConfirmed14,
      )
      const [remoteOrders, remoteMemory, remoteProfile, remoteEarnings, remoteNotifications] =
        await Promise.all([
          listOpenCalls(),
          listMemory(),
          getProfile(),
          getEarnings(),
          listNotifications(),
        ])
      setAccount(session.user)
      setAuthWallet(session.wallet ?? wallet)
      setBalance(session.balance)
      setOrders(remoteOrders)
      setMemory(remoteMemory)
      setEarnings(remoteEarnings)
      setNotifications(remoteNotifications)
      remoteNotifications.forEach((notification) => notifiedIds.current.add(notification.id))
      setChats((current) =>
        current
          .filter(
            (chat) => !chat.ownerId || chat.ownerId === session.user.id,
          )
          .map((chat) =>
            chat.ownerId ? chat : { ...chat, ownerId: session.user.id },
          ),
      )
      if (remoteProfile) {
        setProfile(profileFromServer(remoteProfile))
        setAutoMatchState(remoteProfile.autoMatch)
        setAgentsState(remoteProfile.agents)
      } else {
        setProfile(null)
      }
    },
    [],
  )

  const signOut = useCallback(async () => {
    if (BACKEND_ENABLED) await logout()
    setAccount(null)
    setAuthWallet(null)
    setBalance(null)
    setProfile(null)
    setMemory([])
    setEarnings(null)
    setNotifications([])
    notifiedIds.current.clear()
    setChats([])
    if (BACKEND_ENABLED) {
      window.sessionStorage.removeItem(SESSION_STORAGE_KEY)
      window.localStorage.removeItem('openshelf:prepaid-wallet-session:v1')
      setOrders(await listOpenCalls().catch(() => []))
    }
  }, [])

  const deleteCurrentAccount = useCallback(async () => {
    if (BACKEND_ENABLED) await deleteAccount()
    setAccount(null)
    setAuthWallet(null)
    setBalance(null)
    setProfile(null)
    setMemory([])
    setEarnings(null)
    setNotifications([])
    notifiedIds.current.clear()
    setChats([])
    setOrders(BACKEND_ENABLED ? await listOpenCalls().catch(() => []) : [])
    try {
      window.localStorage.removeItem(STORAGE_KEY)
      window.localStorage.removeItem('openshelf:prepaid-wallet-session:v1')
      window.sessionStorage.removeItem(SESSION_STORAGE_KEY)
    } catch {
      // Storage is optional.
    }
  }, [])

  const cancelOrder = useCallback(async (orderId: string) => {
    if (!BACKEND_ENABLED) {
      setOrders((prev) =>
        prev.map((order) =>
          order.id === orderId ? { ...order, status: 'cancelled' } : order,
        ),
      )
      return
    }
    const cancelled = await cancelOpenCall(orderId)
    setOrders((prev) =>
      prev.map((order) => (order.id === orderId ? cancelled : order)),
    )
    setBalance(await getBalance())
  }, [])

  const clearAll = useCallback(() => {
    setChats([])
    setOrders([])
    setMemory([])
    setEarnings(null)
    setNotifications([])
  }, [])

  const suspended = (profile?.strikes ?? 0) >= STRIKE_LIMIT

  const value = useMemo<UiValue>(
    () => ({
      collapsed,
      setCollapsed,
      agents,
      setAgents,
      autoMatch,
      setAutoMatch,
      setBrowserAlerts,
      setEmailAlerts,
      mobileSidebar,
      setMobileSidebar,
      chats,
      orders,
      memory,
      earnings,
      notifications,
      markNotificationsRead,
      balance,
      account,
      authWallet,
      authReady,
      profile,
      saveProfile,
      verifyPayoutWallet,
      authenticateWallet,
      signOut,
      deleteCurrentAccount,
      suspended,
      disputeStrike,
      refreshLedger,
      createChat,
      patchChat,
      appendAssistant,
      patchMessage,
      placeOrder,
      answerOrder,
      cancelOrder,
      clearAll,
    }),
    [
      collapsed,
      agents,
      setAgents,
      autoMatch,
      setAutoMatch,
      setBrowserAlerts,
      setEmailAlerts,
      mobileSidebar,
      chats,
      orders,
      memory,
      earnings,
      notifications,
      markNotificationsRead,
      balance,
      account,
      authWallet,
      authReady,
      profile,
      saveProfile,
      verifyPayoutWallet,
      authenticateWallet,
      signOut,
      deleteCurrentAccount,
      suspended,
      disputeStrike,
      refreshLedger,
      createChat,
      patchChat,
      appendAssistant,
      patchMessage,
      placeOrder,
      answerOrder,
      cancelOrder,
      clearAll,
    ],
  )

  return <UiContext.Provider value={value}>{children}</UiContext.Provider>
}

// oxlint-disable-next-line react/only-export-components -- colocated context hook.
export function useUi() {
  const ctx = useContext(UiContext)
  if (!ctx) throw new Error('useUi must be used inside <UiProvider>')
  return ctx
}
