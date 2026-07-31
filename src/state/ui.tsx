import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'

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
  createChat: (prompt: string) => string
  appendAssistant: (chatId: string, message: ChatMessage) => void
  patchMessage: (
    chatId: string,
    messageId: string,
    patch: Partial<ChatMessage>,
  ) => void
  placeOrder: (order: Omit<Order, 'id' | 'createdAt' | 'answered'>) => string
  answerOrder: (orderId: string, answer: string) => void
  clearAll: () => void
}

const UiContext = createContext<UiValue | null>(null)
const STORAGE_KEY = 'openshelf:v1'

/**
 * Demo seed. "An empty shelf leaves the librarian nothing to do" was the biggest
 * open problem in the meeting, and a 3-minute demo cannot open on an empty
 * dashboard, so a few live open calls ship pre-loaded.
 */
const SEED_ORDERS: Order[] = [
  {
    id: 'o_seed_1',
    question:
      'Weekday lunch in Seongsu with no queue and under 15 minutes — where do you actually go?',
    unitPrice: 300,
    target: 7,
    answered: 4,
    createdAt: Date.now() - 1000 * 60 * 42,
    mine: false,
    shelf: 'Seongsu daily life',
  },
  {
    id: 'o_seed_2',
    question:
      'Getting a kid ready for first grade — what actually cost the most? Especially the things you did not see coming.',
    unitPrice: 500,
    target: 12,
    answered: 9,
    createdAt: Date.now() - 1000 * 60 * 60 * 5,
    mine: false,
    shelf: 'Primary school parents',
  },
  {
    id: 'o_seed_3',
    question:
      'If you have run a shop for 3+ years: setting delivery-app fees aside, what actually ate your margin?',
    unitPrice: 800,
    target: 10,
    answered: 2,
    createdAt: Date.now() - 1000 * 60 * 60 * 26,
    mine: false,
    shelf: 'Small shop owners',
  },
  {
    id: 'o_seed_4',
    question:
      'Lived in Paris a year or more: a dinner spot tourists never reach that you go back to.',
    unitPrice: 400,
    target: 8,
    answered: 8,
    createdAt: Date.now() - 1000 * 60 * 60 * 50,
    mine: false,
    shelf: 'Living in Paris',
  },
]

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
  agents: boolean
  autoMatch: boolean
}

function load(): Persisted {
  const fallback: Persisted = {
    chats: [],
    orders: SEED_ORDERS,
    memory: SEED_MEMORY,
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
      orders: parsed.orders ?? SEED_ORDERS,
      memory: parsed.memory ?? SEED_MEMORY,
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

  useEffect(() => {
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ chats, orders, memory, agents, autoMatch }),
      )
    } catch {
      /* storage disabled — the app still works, it just won't persist */
    }
  }, [chats, orders, memory, agents, autoMatch])

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
    (order: Omit<Order, 'id' | 'createdAt' | 'answered'>) => {
      const id = `o_${Date.now().toString(36)}${Math.random()
        .toString(36)
        .slice(2, 5)}`
      setOrders((prev) => [
        { ...order, id, createdAt: Date.now(), answered: 0 },
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
