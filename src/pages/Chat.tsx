import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowUpRight,
  Check,
  Coins,
  Loader2,
  Menu,
  Search,
  SlidersHorizontal,
} from 'lucide-react'
import { Composer } from '@/components/Composer'
import { Button } from '@/components/ui/button'
import { SHELVES, type Shelf } from '@/data/shelf'
import { getChatAnswers, resolveQuestion, type Resolution } from '@/lib/api'
import { cn } from '@/lib/utils'
import { explorerUrl, openDocuments, PaymentError } from '@/lib/x402'
import { DEVNET_USDC, shortKey, useWallet } from '@/state/wallet'
import { useUi, type Citation } from '@/state/ui'

/**
 * The life of one question — the 7 steps the meeting locked, as state.
 *
 *   1 ask  2 search  3 rank  4 hit/miss  5 open call  6 x402  7 accrue
 *
 * Step 4 is the whole service. A hit ends as search; a miss posts an open call
 * on the spot. The browser-wallet demo confirms every spend because Phantom
 * asks the person to sign each document payment.
 */

type Phase =
  | 'searching' // 2
  | 'ranking' // 3
  | 'confirm' // between 4 and 6, when the spend needs confirming
  | 'ask-order' // 4 missed → "want me to ask around?"
  | 'ask-count' // "how many people?"
  | 'ask-price' // "what do you want to pay per answer?"
  | 'ordered' // 5, call posted
  | 'declined' // no call placed
  | 'settling' // 6, paying for the opens
  | 'answered' // 6·7
  | 'failed' // settlement did not go through

const KRW_PER_USDC = Number(import.meta.env.VITE_KRW_PER_USDC ?? 1350)

const STEPS = [
  { n: 2, label: 'Search the shelves', blurb: 'People\u2019s documents, not the web' },
  { n: 3, label: 'Rank by similarity', blurb: 'The closest few, not everything' },
  { n: 4, label: 'Hit or miss', blurb: 'A miss posts an open call' },
]

const COUNT_CHOICES = [3, 7, 12]
const PRICE_CHOICES = [0, 300, 500, 800]

export default function Chat() {
  const { id } = useParams()
  const navigate = useNavigate()
  const {
    chats,
    appendAssistant,
    placeOrder,
    cancelOrder,
    orders,
    refreshLedger,
    account,
    setMobileSidebar,
  } = useUi()
  const wallet = useWallet()
  const chat = chats.find((c) => c.id === id)

  const [phase, setPhase] = useState<Phase>('searching')
  const [hits, setHits] = useState<{ shelf: Shelf; score: number }[]>([])
  const [pending, setPending] = useState<Citation[]>([])
  const [count, setCount] = useState<number | null>(null)
  const [placedOrderId, setPlacedOrderId] = useState<string | null>(null)
  const [payError, setPayError] = useState<string | null>(null)
  const [queryId, setQueryId] = useState<string | null>(null)
  const [resolutionReason, setResolutionReason] = useState<Resolution['reason'] | null>(null)
  const [openCallDraft, setOpenCallDraft] = useState<Resolution['openCall'] | null>(
    null,
  )
  const startedRef = useRef<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const lastUser = useMemo(
    () => [...(chat?.messages ?? [])].reverse().find((m) => m.role === 'user'),
    [chat],
  )
  const hasAnswer = chat?.messages.some((m) => m.role === 'assistant') ?? false
  const chatId = chat?.id
  const prompt = lastUser?.content
  const existingOrder = orders.find(
    (order) => order.mine && order.chatId === chatId && order.status !== 'cancelled',
  )

  const total = pending.reduce((sum, c) => sum + c.price, 0)
  const estimatedUsdc =
    pending.reduce(
      (sum, citation) =>
        sum + Math.ceil((citation.price * 1_000_000) / KRW_PER_USDC),
      0,
    ) / 1_000_000
  const countChoices = useMemo(
    () =>
      [...new Set([openCallDraft?.answersNeeded, ...COUNT_CHOICES])].filter(
        (value): value is number => typeof value === 'number' && value > 0,
      ),
    [openCallDraft?.answersNeeded],
  )
  const priceChoices = useMemo(
    () =>
      [...new Set([openCallDraft?.suggestedUnitPriceKrw, ...PRICE_CHOICES])].filter(
        (value): value is number => typeof value === 'number' && value >= 0,
      ),
    [openCallDraft?.suggestedUnitPriceKrw],
  )

  /** Steps 6–7. Phantom signs one exact x402/SVM payment per opened document. */
  const settle = useCallback(
    async (
      citations: Citation[],
      shelfName: string,
      resolvedQueryId: string | null,
    ) => {
      if (!chatId || !resolvedQueryId) return
      setPhase('settling')
      setPayError(null)
      try {
        const result = await openDocuments({
          queryId: resolvedQueryId,
          question: prompt ?? '',
          payer: wallet.pubkey,
          docs: citations.map((c) => ({
            handle: c.handle,
            shelf: c.shelf,
            price: c.price,
          })),
        })
        appendAssistant(chatId, {
          id: `${chatId}_a`,
          role: 'assistant',
          content: `Opened ${result.citations.length} matching documents from the ${shelfName} shelf. Each passage below is quoted as written.${result.settlement.partial ? ' Payment stopped before the remaining documents, so they stayed closed.' : ''}`,
          citations: result.citations,
          settlement: {
            count: result.settlement.count,
            total: result.settlement.total,
            txSig: result.settlement.txSig,
            txSigs: result.settlement.txSigs,
            network: result.settlement.network,
            partial: result.settlement.partial,
          },
        })
        void refreshLedger().catch(() => undefined)
        setPhase('answered')
      } catch (e) {
        setPayError(
          e instanceof PaymentError ? e.message : 'Settlement did not go through.',
        )
        setPhase('failed')
      }
    },
    [appendAssistant, chatId, prompt, refreshLedger, wallet.pubkey],
  )

  // search → rank → branch. The guard is released in cleanup so StrictMode's
  // remount reschedules instead of leaving the run half-finished.
  useEffect(() => {
    if (!chatId || !prompt || hasAnswer || existingOrder) return
    if (startedRef.current === chatId) return
    startedRef.current = chatId

    let cancelled = false
    setPhase('searching')
    setHits([])
    setPayError(null)
    setQueryId(null)
    setResolutionReason(null)
    setOpenCallDraft(null)

    const run = async () => {
      try {
        const [resolution] = await Promise.all([
          resolveQuestion(prompt, 5, chat?.filters),
          new Promise((resolve) => window.setTimeout(resolve, 700)),
        ])
        if (cancelled) return

        setQueryId(resolution.queryId)
        setResolutionReason(resolution.reason)
        setOpenCallDraft(resolution.openCall ?? null)
        const seen = new Set<string>()
        const ranked = resolution.matches.flatMap((match) => {
          if (seen.has(match.shelfId)) return []
          const shelf = SHELVES.find((item) => item.id === match.shelfId)
          if (!shelf) return []
          seen.add(match.shelfId)
          return [{ shelf, score: match.score }]
        })
        setPhase('ranking')
        setHits(ranked.slice(0, 3))
        await new Promise((resolve) => window.setTimeout(resolve, 650))
        if (cancelled) return

        // Step 4 — this is where it splits. Partial coverage is still a miss:
        // the open call asks only for the missing number of answers.
        if (resolution.decision === 'miss') {
          setPhase('ask-order')
          return
        }
        const cites: Citation[] = resolution.matches.map((match) => ({
          handle: match.handle,
          shelf: match.shelf,
          excerpt: '',
          price: match.priceKrw,
        }))
        setPending(cites)
        setPhase('confirm')
      } catch (error) {
        if (cancelled) return
        setPayError(error instanceof Error ? error.message : 'Search failed.')
        setPhase('failed')
      }
    }
    void run()

    return () => {
      cancelled = true
      startedRef.current = null
    }
  }, [chat?.filters, chatId, existingOrder, prompt, hasAnswer, settle])

  useEffect(() => {
    if (!chatId || !existingOrder || !account) return
    setPlacedOrderId(existingOrder.id)
    setPhase('ordered')
    let stopped = false
    const collect = async () => {
      const answers = await getChatAnswers(chatId)
      if (stopped) return
      for (const answer of answers) {
        const messageId = `open_call_answer_${answer.id}`
        if (chat?.messages.some((message) => message.id === messageId)) continue
        appendAssistant(chatId, {
          id: messageId,
          role: 'assistant',
          content: 'A targeted open-call answer arrived. The passage was paid from the reserved sandbox escrow.',
          citations: [
            {
              handle: answer.handle,
              shelf: answer.shelf,
              excerpt: answer.excerpt,
              price: answer.price,
              demographics: answer.demographics,
            },
          ],
          settlement: {
            count: 1,
            total: answer.price,
            network: 'sandbox-escrow',
          },
        })
      }
    }
    void collect().catch(() => undefined)
    const interval = window.setInterval(() => void collect().catch(() => undefined), 3_000)
    return () => {
      stopped = true
      window.clearInterval(interval)
    }
  }, [account, appendAssistant, chat?.messages, chatId, existingOrder])

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: 'smooth',
    })
  }, [chat?.messages, phase, hits])

  if (!chat) return <Navigate to="/" replace />

  const placedOrder = orders.find((o) => o.id === placedOrderId)

  return (
    <div className="page-enter flex h-full min-h-0 flex-1 flex-col">
      <div className="flex min-h-8 items-center justify-between gap-4 px-4 pt-4 sm:px-6 sm:pt-6">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            aria-label="Open sidebar"
            onClick={() => setMobileSidebar(true)}
            className="flex size-7 shrink-0 items-center justify-center text-muted-foreground md:hidden"
          >
            <Menu className="size-4" />
          </button>
          <h1 className="truncate font-sans text-base font-medium">
            {chat.title}
          </h1>
        </div>
        <Link
          to="/dashboard"
          className="shrink-0 font-mono text-xs uppercase tracking-[1px] text-muted-foreground transition-colors hover:text-foreground"
        >
          Dashboard
        </Link>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6">
          {chat.messages.map((m) =>
            m.role === 'user' ? (
              <div key={m.id} className="flex justify-end">
                <div className="max-w-[85%] rounded-[6px] bg-foreground/[0.05] px-4 py-3 text-[15px] leading-relaxed">
                  {m.content}
                </div>
              </div>
            ) : (
              <div key={m.id} className="flex flex-col gap-3">
                <AgentLabel />
                <p className="text-[15px] leading-7 text-foreground">
                  {m.content}
                </p>

                {m.citations?.length ? (
                  <ul className="flex flex-col gap-2">
                    {m.citations.map((c) => (
                      <li
                        key={c.handle}
                        className="rounded-[6px] border border-border bg-card p-4"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-mono text-xs uppercase tracking-[1px] text-muted-foreground">
                            {c.handle} · {c.shelf}
                          </span>
                          <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                            ₩{c.price.toLocaleString()}
                          </span>
                        </div>
                        <p className="mt-2 text-[15px] leading-relaxed text-foreground/90">
                          “{c.excerpt}”
                        </p>
                        {c.demographics ? (
                          <p className="mt-2 font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">
                            {c.demographics.ageBand} · {c.demographics.region} ·{' '}
                            {c.demographics.household} · {c.demographics.field}
                          </p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}

                {m.settlement ? (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[4px] bg-foreground/[0.04] px-3 py-2 font-mono text-xs text-muted-foreground">
                    <Coins className="size-3.5" />
                    <span>
                      {m.settlement.count} opens ·{' '}
                      <span className="tabular-nums text-foreground">
                        ₩{m.settlement.total.toLocaleString()}
                      </span>
                    </span>
                    <span className="text-muted-foreground/60">
                      {m.settlement.network === 'demo'
                        ? 'demo ledger · x402 gateway disabled'
                        : m.settlement.network === 'sandbox-escrow'
                          ? 'paid from reserved sandbox escrow'
                        : m.settlement.network === 'offline'
                          ? 'offline preview · no payment sent'
                          : 'settled through x402 · unopened documents cost nothing'}
                    </span>
                    {(m.settlement.txSigs?.length
                      ? m.settlement.txSigs
                      : m.settlement.txSig
                        ? [m.settlement.txSig]
                        : []
                    ).map((signature, index, signatures) => (
                      <a
                        key={signature}
                        href={explorerUrl(
                          signature,
                          m.settlement?.network ?? 'devnet',
                        )}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 underline decoration-dotted underline-offset-4 transition-colors hover:text-foreground"
                      >
                        {signatures.length > 1 ? `tx ${index + 1}` : signature.slice(0, 8)}…
                        <ArrowUpRight className="size-3" />
                      </a>
                    ))}
                  </div>
                ) : null}
              </div>
            ),
          )}

          {!hasAnswer ? (
            <div className="flex flex-col gap-4 rounded-[6px] border border-border bg-card p-4">
              <TraceSteps phase={phase} hits={hits} />

              {phase === 'confirm' ? (
                <Branch
                  title={`${pending.length} people already match.`}
                  body={`No open call needed. ${pending.length} documents cost ₩${total.toLocaleString()} total (about ${estimatedUsdc.toFixed(6)} USDC). This browser demo requests ${pending.length} Phantom approval${pending.length === 1 ? '' : 's'} because each author is paid separately.`}
                >
                  <div className="w-full rounded-[4px] bg-foreground/[0.04] px-3 py-2 font-mono text-[10px] uppercase leading-relaxed tracking-[0.8px] text-muted-foreground">
                    Devnet USDC may appear as “Unknown” in Phantom. Verify mint{' '}
                    <span className="text-foreground" title={DEVNET_USDC}>
                      {shortKey(DEVNET_USDC)}
                    </span>{' '}
                    and network Devnet before approving.
                  </div>
                  {wallet.pubkey ? (
                    <Button
                      variant="mono"
                      size="mono"
                      onClick={() =>
                        void settle(
                          pending,
                          pending[0]?.shelf ?? 'Unsorted',
                          queryId,
                        )
                      }
                    >
                      Pay and open · {pending.length} approval{pending.length === 1 ? '' : 's'}
                    </Button>
                  ) : (
                    <Button
                      variant="mono"
                      size="mono"
                      onClick={() => void wallet.connect()}
                    >
                      Connect Phantom to pay
                    </Button>
                  )}
                  <Button
                    variant="monoMuted"
                    size="mono"
                    onClick={() => setPhase('ask-order')}
                  >
                    Post a call instead
                  </Button>
                </Branch>
              ) : null}

              {phase === 'ask-order' ? (
                <Branch
                  title="Nobody has covered this yet."
                  body={
                    resolutionReason === 'insufficient_coverage'
                      ? 'Some relevant documents exist, but not enough for the requested coverage. Want me to fill the gap?'
                      : resolutionReason === 'budget_too_low'
                        ? 'Relevant documents exist, but they do not fit the current budget. Want me to ask at a new price?'
                        : 'Nothing on the shelves matches. Want me to ask people?'
                  }
                >
                  <Button
                    variant="mono"
                    size="mono"
                    onClick={() => setPhase('ask-count')}
                  >
                    Ask them
                  </Button>
                  <Button
                    variant="monoMuted"
                    size="mono"
                    onClick={() => setPhase('declined')}
                  >
                    No thanks
                  </Button>
                </Branch>
              ) : null}

              {phase === 'ask-count' ? (
                <Branch
                  title={
                    openCallDraft?.existingMatches
                      ? 'How many more people?'
                      : 'How many people?'
                  }
                  body={
                    openCallDraft?.existingMatches
                      ? `${openCallDraft.existingMatches} relevant documents already exist. ${openCallDraft.answersNeeded} more fills the original ${openCallDraft.targetAnswers}-person request.`
                      : 'More answers means you see where they start to disagree.'
                  }
                >
                  {countChoices.map((n) => (
                    <Button
                      key={n}
                      variant="monoMuted"
                      size="mono"
                      onClick={() => {
                        setCount(n)
                        setPhase('ask-price')
                      }}
                    >
                      {n}
                    </Button>
                  ))}
                </Branch>
              ) : null}

              {phase === 'ask-price' ? (
                <Branch
                  title="What do you want to pay per answer?"
                  body="₩0 still gets answers. People read the demand and write it up in advance because they expect it to sell later."
                >
                  {priceChoices.map((p) => (
                    <Button
                      key={p}
                      variant={
                        p === (openCallDraft?.suggestedUnitPriceKrw ?? 300)
                          ? 'mono'
                          : 'monoMuted'
                      }
                      size="mono"
                      onClick={() => {
                        if (!account) {
                          navigate('/login?mode=signup')
                          return
                        }
                        void placeOrder({
                          question: prompt ?? '',
                          unitPrice: p,
                          target: count ?? 7,
                          mine: true,
                          chatId,
                          shelf: hits[0]?.shelf.name ?? 'Unsorted',
                          filters: chat.filters,
                        }).then(
                          (orderId) => {
                            setPlacedOrderId(orderId)
                            setPhase('ordered')
                          },
                          (error) => {
                            setPayError(
                              error instanceof Error
                                ? error.message
                                : 'The call could not be posted.',
                            )
                            setPhase('failed')
                          },
                        )
                      }}
                    >
                      {p === 0 ? '₩0' : `₩${p.toLocaleString()}`}
                    </Button>
                  ))}
                </Branch>
              ) : null}

              {phase === 'ordered' && placedOrder ? (
                <Branch
                  title="Call posted."
                    body={`${placedOrder.target} people · ₩${placedOrder.unitPrice.toLocaleString()} each. ₩${placedOrder.escrowRemainingKrw?.toLocaleString() ?? (placedOrder.target * placedOrder.unitPrice).toLocaleString()} is reserved; accepted answers are paid from it and the unused amount is refundable.`}
                >
                  <Button
                    variant="mono"
                    size="mono"
                    onClick={() => navigate('/dashboard')}
                  >
                    View on dashboard
                  </Button>
                  <Button
                    variant="monoMuted"
                    size="mono"
                    onClick={() =>
                      void cancelOrder(placedOrder.id).then(() => setPhase('declined'))
                    }
                  >
                    Cancel and refund
                  </Button>
                </Branch>
              ) : null}

              {phase === 'settling' ? (
                <Branch
                  title="Settling over x402…"
                  body="Requesting the documents, paying each author, then returning the passages."
                />
              ) : null}

              {phase === 'failed' ? (
                <Branch
                  title={queryId ? 'Settlement did not go through.' : 'SHELF-1 could not reach the backend.'}
                  body={
                    payError ??
                    'The documents stayed closed. If Phantom already showed a confirmed transfer, check the explorer before retrying.'
                  }
                />
              ) : null}

              {phase === 'declined' ? (
                <Branch
                  title="Understood."
                  body="No call was posted, so nothing was charged. Try again with different conditions any time."
                />
              ) : null}
            </div>
          ) : null}

          {hasAnswer ? (
            <p className="text-center font-mono text-xs uppercase tracking-[1px] text-muted-foreground">
              Each author was paid onchain · these documents can auto-match again
            </p>
          ) : null}
        </div>
      </div>

      <div className="shrink-0 border-t border-border bg-background px-4 pb-6 pt-3 sm:px-6">
        <div className="mx-auto w-full max-w-3xl">
          <Composer variant="flat" />
        </div>
      </div>
    </div>
  )
}

function AgentLabel() {
  return (
    <div className="flex items-center gap-2">
      <span className="flex size-6 items-center justify-center rounded-[2px] bg-foreground">
        <img className="size-3.5 invert" src="/SHELF-SYMBOL.svg" alt="" />
      </span>
      <span className="font-mono text-xs font-medium uppercase tracking-[1px] text-muted-foreground">
        SHELF-1
      </span>
    </div>
  )
}

function TraceSteps({
  phase,
  hits,
}: {
  phase: Phase
  hits: { shelf: Shelf; score: number }[]
}) {
  // Search and ranking are the only long-running trace phases. Once ranking
  // resolves, step 4 has made its hit/miss decision; payment, open-call, and
  // failure states are downstream outcomes and must not leave step 4 spinning.
  const reached = phase === 'searching' ? 0 : phase === 'ranking' ? 1 : STEPS.length
  const icons = [Search, SlidersHorizontal, Coins]

  return (
    <div className="flex flex-col gap-2">
      {STEPS.map((s, i) => {
        const state = i < reached ? 'done' : i === reached ? 'active' : 'idle'
        const Icon = icons[i]
        return (
          <div key={s.n} className="flex items-start gap-2.5">
            <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
              {state === 'done' ? (
                <Check className="size-3.5 text-[#0F766E]" />
              ) : state === 'active' ? (
                <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
              ) : (
                <Icon className="size-3 text-muted-foreground/40" />
              )}
            </span>
            <div className="flex min-w-0 flex-col">
              <span
                className={cn(
                  'font-mono text-xs font-semibold uppercase tracking-wider',
                  state === 'idle'
                    ? 'text-muted-foreground/50'
                    : 'text-foreground',
                )}
              >
                STEP {s.n} · {s.label}
              </span>
              <span className="text-sm leading-snug text-muted-foreground">
                {s.blurb}
              </span>
              {i === 1 && hits.length ? (
                <span className="mt-1 flex flex-wrap gap-1.5">
                  {hits.map((h) => (
                    <span
                      key={h.shelf.id}
                      className="inline-flex items-center gap-1.5 rounded-[3px] bg-foreground/[0.06] px-2 py-0.5 font-mono text-[11px]"
                    >
                      <span
                        className="size-1.5 rounded-full"
                        style={{ backgroundColor: h.shelf.accent }}
                      />
                      {h.shelf.name}
                    </span>
                  ))}
                </span>
              ) : null}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function Branch({
  title,
  body,
  children,
}: {
  title: string
  body: string
  children?: React.ReactNode
}) {
  return (
    <div className="animate-fade-in-up flex flex-col gap-3 border-t border-border pt-4">
      <div className="flex flex-col gap-1">
        <span className="font-sans text-[15px] font-medium">{title}</span>
        <span className="text-sm leading-relaxed text-muted-foreground">
          {body}
        </span>
      </div>
      {children ? (
        <div className="flex flex-wrap gap-2">{children}</div>
      ) : null}
    </div>
  )
}
