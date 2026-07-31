import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { categoryFor, type CategoryId } from '@/data/categories'

/** One quoted MD. Once the open is confirmed it becomes the settlement unit. */
export type Citation = {
  handle: string
  shelf: string
  excerpt: string
  price: number
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
    network?: string
  }
}

export type Chat = {
  id: string
  title: string
  createdAt: number
  messages: ChatMessage[]
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
  agreedAt: number
}

/** One line of the memory stream. Recent entries carry more weight. */
export type MemoryEntry = {
  id: string
  question: string
  answer: string
  shelf: string
  earned: number
  createdAt: number
  via: 'Open call' | 'Auto-match'
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
  /** null until onboarding completes. Temp sign-in is what creates it. */
  profile: Profile | null
  saveProfile: (p: Omit<Profile, 'strikes' | 'agreedAt'>) => void
  signOut: () => void
  createChat: (prompt: string) => string
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
  ) => string
  answerOrder: (orderId: string, answer: string) => void
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

/** Orders stored before the taxonomy existed get a category on the way in. */
function normalise(orders: Order[]): Order[] {
  return orders.map((o) =>
    o.category ? o : { ...o, category: categoryFor(o.shelf, o.question) },
  )
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
      memory: parsed.memory ?? SEED_MEMORY,
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
  const [agents, setAgents] = useState(initial.agents)
  const [autoMatch, setAutoMatch] = useState(initial.autoMatch)
  const [chats, setChats] = useState<Chat[]>(initial.chats)
  const [orders, setOrders] = useState<Order[]>(initial.orders)
  const [memory, setMemory] = useState<MemoryEntry[]>(initial.memory)
  const [profile, setProfile] = useState<Profile | null>(initial.profile)

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

  const createChat = useCallback((prompt: string) => {
    const id = `c_${Date.now().toString(36)}${Math.random()
      .toString(36)
      .slice(2, 6)}`
    const title = prompt.trim().slice(0, 60) || 'New question'
    setChats((prev) => [
      {
        id,
        title,
        createdAt: Date.now(),
        messages: [{ id: `${id}_u`, role: 'user', content: prompt.trim() }],
      },
      ...prev,
    ])
    return id
  }, [])

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
    (
      order: Omit<Order, 'id' | 'createdAt' | 'answered' | 'category'> & {
        category?: CategoryId
      },
    ) => {
      const id = `o_${Date.now().toString(36)}${Math.random()
        .toString(36)
        .slice(2, 5)}`
      setOrders((prev) => [
        {
          ...order,
          category: order.category ?? categoryFor(order.shelf, order.question),
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
    (orderId: string, answer: string) => {
      const order = orders.find((o) => o.id === orderId)
      if (!order || order.answered >= order.target) return

      setOrders((prev) =>
        prev.map((o) =>
          o.id === orderId
            ? { ...o, answered: Math.min(o.target, o.answered + 1) }
            : o,
        ),
      )
      setMemory((prev) => [
        {
          id: `m_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
          question: order.question,
          answer,
          shelf: order.shelf,
          earned: order.unitPrice,
          createdAt: Date.now(),
          via: 'Open call' as const,
        },
        ...prev,
      ])
    },
    [orders],
  )

  /**
   * Completing onboarding is what creates the account in this build. Strikes
   * start at zero and the conduct agreement is stamped, because the ladder is
   * only fair if the person saw it before they answered anything.
   */
  const saveProfile = useCallback(
    (p: Omit<Profile, 'strikes' | 'agreedAt'>) => {
      setProfile({ ...p, strikes: 0, agreedAt: Date.now() })
    },
    [],
  )

  const signOut = useCallback(() => setProfile(null), [])

  const clearAll = useCallback(() => {
    setChats([])
    setOrders(SEED_ORDERS)
    setMemory(SEED_MEMORY)
  }, [])

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
      profile,
      saveProfile,
      signOut,
      createChat,
      appendAssistant,
      patchMessage,
      placeOrder,
      answerOrder,
      clearAll,
    }),
    [
      collapsed,
      agents,
      autoMatch,
      mobileSidebar,
      chats,
      orders,
      memory,
      profile,
      saveProfile,
      signOut,
      createChat,
      appendAssistant,
      patchMessage,
      placeOrder,
      answerOrder,
      clearAll,
    ],
  )

  return <UiContext.Provider value={value}>{children}</UiContext.Provider>
}

export function useUi() {
  const ctx = useContext(UiContext)
  if (!ctx) throw new Error('useUi must be used inside <UiProvider>')
  return ctx
}
