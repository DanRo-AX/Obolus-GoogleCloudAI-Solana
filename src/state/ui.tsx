import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { categoryFor, type CategoryId } from '@/data/categories'
import { STRIKE_LIMIT } from '@/data/onboarding'
import {
  BACKEND_ENABLED,
  cancelOpenCall,
  createOpenCall,
  deleteAccount,
  disputeMemory,
  getBalance,
  getEarnings,
  getProfile,
  getSession,
  login as loginAccount,
  listMemory,
  listOpenCalls,
  logout,
  register as registerAccount,
  submitAnswer,
  updatePreferences,
  upsertProfile,
  type EarningsSummary,
  type Account,
  type BalanceSummary,
  type DemographicBands,
  type ServerProfile,
  type TargetFilters,
} from '@/lib/api'
import type { Issue } from '@/lib/quality'

/** One quoted MD. Once the open is confirmed it becomes the settlement unit. */
export type Citation = {
  handle: string
  shelf: string
  excerpt: string
  price: number
  demographics?: DemographicBands
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
  }
}

export type Chat = {
  id: string
  title: string
  createdAt: number
  messages: ChatMessage[]
  filters?: TargetFilters
  ownerId?: string
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
  status?: 'open' | 'filled' | 'cancelled'
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
  agreedAt: number
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
  via: 'Open call' | 'Auto-match'
  /** Voided entries keep the attempted answer but earn zero until disputed. */
  status: 'settled' | 'voided'
  disputeStatus?: 'pending' | 'approved' | 'rejected'
  /** Which rules the answer tripped, if any. */
  flags?: Issue[]
  /** Buyer rating out of 5, once someone has opened it. */
  rating?: number
  /** Private warm-up context. It is retained but never indexed or sold. */
  interviewResponses?: InterviewResponse[]
}

type UiValue = {
  collapsed: boolean
  setCollapsed: (v: boolean) => void
  agents: boolean
  setAgents: (v: boolean) => void
  autoMatch: boolean
  setAutoMatch: (v: boolean) => void
  mobileSidebar: boolean
  setMobileSidebar: (v: boolean) => void
  chats: Chat[]
  orders: Order[]
  memory: MemoryEntry[]
  earnings: EarningsSummary | null
  balance: BalanceSummary | null
  account: Account | null
  authReady: boolean
  /** null until an authenticated account completes onboarding. */
  profile: Profile | null
  saveProfile: (
    p: Omit<Profile, 'strikes' | 'disputeUsed' | 'agreedAt'>,
  ) => Promise<void>
  authenticate: (
    email: string,
    password: string,
    signup: boolean,
  ) => Promise<void>
  signOut: () => Promise<void>
  deleteCurrentAccount: () => Promise<void>
  /** Three strikes. Set once the ladder runs out. */
  suspended: boolean
  /** Spend the one dispute on a voided answer: strike lifted, payment restored. */
  disputeStrike: (memoryId: string, reason: string) => Promise<void>
  refreshLedger: () => Promise<void>
  createChat: (prompt: string, filters?: TargetFilters) => string
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

const HOUR = 1000 * 60 * 60

type Seed = [
  id: string,
  category: CategoryId,
  shelf: string,
  question: string,
  unitPrice: number,
  target: number,
  answered: number,
  agedHours: number,
]

const SEEDS: Seed[] = [
  ['o_seed_1', 'life', 'Seongsu daily life', 'Weekday lunch in Seongsu with no queue and under 15 minutes — where do you actually go?', 300, 7, 4, 0.7],
  ['o_seed_2', 'family', 'Primary school parents', 'Getting a kid ready for first grade — what actually cost the most? Especially the things you did not see coming.', 500, 12, 9, 5],
  ['o_seed_3', 'business', 'Small shop owners', 'If you have run a shop for 3+ years: setting delivery-app fees aside, what actually ate your margin?', 800, 10, 2, 26],
  ['o_seed_4', 'travel', 'Living in Paris', 'Lived in Paris a year or more: a dinner spot tourists never reach that you go back to.', 400, 8, 8, 50],
  ['o_seed_5', 'engineering', 'Small-team infra', 'You carry the pager for a team under ten. What actually wakes you up, and what did you manage to automate away?', 900, 6, 1, 2],
  ['o_seed_6', 'sales', 'B2B sales', 'B2B outbound in Korea: what gets you a first meeting now that cold email does not?', 1200, 8, 3, 11],
  ['o_seed_7', 'education', 'Public school teachers', 'A class of 30 with one tablet each — what broke in the first month, and what did you stop doing?', 700, 9, 5, 30],
  ['o_seed_8', 'sports', 'Amateur endurance', 'Training for a first sub-4 marathon around a full-time job: what did an ordinary week actually look like?', 600, 10, 6, 8],
  ['o_seed_9', 'money', 'Retail investing', 'You moved a chunk of savings into an index fund during a down month. What did you do in the first week?', 1100, 7, 1, 3],
  ['o_seed_10', 'health', 'Shift workers', 'Two years into shift work — what did you change about sleep that actually held?', 1000, 8, 2, 19],
  ['o_seed_11', 'food', 'Kitchen crews', 'Running a kitchen with two people: which prep did you give up on, and what replaced it?', 750, 6, 4, 40],
  ['o_seed_12', 'engineering', 'Backend migrations', 'Moved a production service off a managed database — what did the bill and the pager look like three months later?', 1400, 5, 0, 0.4],
  ['o_seed_13', 'life', 'Leaving the capital', 'Left Seoul and kept the same job. What got worse that nobody warned you about?', 450, 12, 7, 60],
  ['o_seed_14', 'business', 'Franchise owners', 'First year as a franchise owner: which number in the pitch turned out to be wrong?', 1500, 6, 1, 6],
  ['o_seed_15', 'sales', 'Showroom floor', 'Car showroom: what do you say in the first thirty seconds that changes the rest of it?', 650, 9, 9, 70],
]

/**
 * Demo seed. "An empty shelf leaves the librarian nothing to do" was the biggest
 * open problem in the meeting, and a 3-minute demo cannot open on an empty
 * dashboard, so a spread of live open calls ships pre-loaded — wide enough that
 * the category tabs and the sort are actually doing something.
 */
const SEED_ORDERS: Order[] = SEEDS.map(
  ([id, category, shelf, question, unitPrice, target, answered, agedHours]) => ({
    id,
    category,
    shelf,
    question,
    unitPrice,
    target,
    answered,
    createdAt: Date.now() - agedHours * HOUR,
    mine: false,
  }),
)

const SEED_MEMORY: MemoryEntry[] = [
  {
    id: 'm_seed_1',
    question: 'Weekday lunch in Seongsu without the queue',
    answer:
      'Yeonmujang-gil backs up after 12, so I leave at 11:40 or walk toward Seoul Forest instead. Only two noodle places actually get you out in 15 minutes.',
    shelf: 'Seongsu daily life',
    earned: 300,
    createdAt: Date.now() - 1000 * 60 * 60 * 3,
    via: 'Open call',
    status: 'settled',
    rating: 5,
  },
  {
    id: 'm_seed_2',
    question: 'Fixed costs nobody warns you about when running a cafe',
    answer:
      'Cleaning supplies and consumables cost more than the beans. Cups, sleeves, and the water filter needs changing far more often than you expect — about 1.4x the bean cost per month.',
    shelf: 'Small shop owners',
    earned: 800,
    createdAt: Date.now() - 1000 * 60 * 60 * 20,
    via: 'Auto-match',
    status: 'settled',
    rating: 4,
  },
  {
    id: 'm_seed_3',
    question: 'When to do the weekday grocery run',
    answer:
      'Stopping by after work means the fresh section is already picked over, so I order in the morning and collect in the evening. Pickup saves about 30 minutes over delivery.',
    shelf: 'Weekday routines',
    earned: 250,
    createdAt: Date.now() - 1000 * 60 * 60 * 46,
    via: 'Auto-match',
    status: 'settled',
    rating: 5,
  },
]

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
    agreedAt: profile.agreedAt,
  }
}

function load(): Persisted {
  const fallback: Persisted = {
    chats: [],
    orders: SEED_ORDERS,
    memory: SEED_MEMORY,
    profile: null,
    agents: false,
    autoMatch: true,
  }
  if (typeof window === 'undefined') return fallback
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as Partial<Persisted>
    return {
      chats: parsed.chats ?? [],
      orders: parsed.orders ? normalise(parsed.orders) : SEED_ORDERS,
      memory: parsed.memory ? normaliseMemory(parsed.memory) : SEED_MEMORY,
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
  const [profile, setProfile] = useState<Profile | null>(
    BACKEND_ENABLED ? null : initial.profile,
  )
  const [account, setAccount] = useState<Account | null>(null)
  const [balance, setBalance] = useState<BalanceSummary | null>(null)
  const [authReady, setAuthReady] = useState(!BACKEND_ENABLED)

  useEffect(() => {
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
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
          setChats((current) => current.filter((chat) => !chat.ownerId))
          setMemory([])
          setProfile(null)
          setEarnings(null)
          setBalance(null)
          return
        }
        const [remoteMemory, remoteProfile, remoteEarnings] = await Promise.all([
          listMemory(),
          getProfile(),
          getEarnings(),
        ])
        if (cancelled) return
        setAccount(session.user)
        setChats((current) =>
          current.filter(
            (chat) => !chat.ownerId || chat.ownerId === session.user.id,
          ),
        )
        setBalance(session.balance)
        setMemory(remoteMemory)
        setEarnings(remoteEarnings)
        if (remoteProfile) {
          setProfile(profileFromServer(remoteProfile))
          setAutoMatchState(remoteProfile.autoMatch)
          setAgentsState(remoteProfile.agents)
        }
      } catch {
        // Chat surfaces backend connectivity errors when a request is made.
        // Keeping the seed state here lets the rest of the site still render.
      } finally {
        if (!cancelled) setAuthReady(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const refreshLedger = useCallback(async () => {
    if (!BACKEND_ENABLED) return
    const [remoteMemory, remoteEarnings, remoteBalance] = await Promise.all([
      listMemory(),
      getEarnings(),
      getBalance(),
    ])
    setMemory(remoteMemory)
    setEarnings(remoteEarnings)
    setBalance(remoteBalance)
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
        const created = await createOpenCall({
          question: order.question,
          unitPrice: order.unitPrice,
          target: order.target,
          chatId: order.chatId,
          shelf: order.shelf,
          category,
          filters: order.filters,
        })
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

  const saveProfile = useCallback(
    async (p: Omit<Profile, 'strikes' | 'disputeUsed' | 'agreedAt'>) => {
      if (BACKEND_ENABLED) {
        const saved = await upsertProfile(p, { autoMatch, agents })
        setProfile(profileFromServer(saved))
        setAutoMatchState(saved.autoMatch)
        setAgentsState(saved.agents)
        return
      }
      setProfile({ ...p, strikes: 0, disputeUsed: false, agreedAt: Date.now() })
    },
    [agents, autoMatch],
  )

  const authenticate = useCallback(
    async (email: string, password: string, signup: boolean) => {
      const session = signup
        ? await registerAccount(email, password)
        : await loginAccount(email, password)
      const [remoteOrders, remoteMemory, remoteProfile, remoteEarnings] =
        await Promise.all([listOpenCalls(), listMemory(), getProfile(), getEarnings()])
      setAccount(session.user)
      setBalance(session.balance)
      setOrders(remoteOrders)
      setMemory(remoteMemory)
      setEarnings(remoteEarnings)
      setChats([])
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
    setBalance(null)
    setProfile(null)
    setMemory([])
    setEarnings(null)
    setChats([])
    if (BACKEND_ENABLED) {
      setOrders(await listOpenCalls().catch(() => SEED_ORDERS))
    }
  }, [])

  const deleteCurrentAccount = useCallback(async () => {
    if (BACKEND_ENABLED) await deleteAccount()
    setAccount(null)
    setBalance(null)
    setProfile(null)
    setMemory([])
    setEarnings(null)
    setChats([])
    setOrders(BACKEND_ENABLED ? await listOpenCalls().catch(() => SEED_ORDERS) : SEED_ORDERS)
    try {
      window.localStorage.removeItem(STORAGE_KEY)
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
    setOrders(SEED_ORDERS)
    setMemory(SEED_MEMORY)
    setEarnings(null)
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
      mobileSidebar,
      setMobileSidebar,
      chats,
      orders,
      memory,
      earnings,
      balance,
      account,
      authReady,
      profile,
      saveProfile,
      authenticate,
      signOut,
      deleteCurrentAccount,
      suspended,
      disputeStrike,
      refreshLedger,
      createChat,
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
      mobileSidebar,
      chats,
      orders,
      memory,
      earnings,
      balance,
      account,
      authReady,
      profile,
      saveProfile,
      authenticate,
      signOut,
      deleteCurrentAccount,
      suspended,
      disputeStrike,
      refreshLedger,
      createChat,
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
