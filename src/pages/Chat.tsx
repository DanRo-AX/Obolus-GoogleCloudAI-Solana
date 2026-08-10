import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowUpRight,
  Check,
  Coins,
  Flag,
  Loader2,
  Menu,
  Search,
  SlidersHorizontal,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
} from 'lucide-react'
import { Composer } from '@/components/Composer'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n'
import {
  getChatAnswers,
  generateAiBaseline,
  resolveQuestion,
  submitDocumentFeedback,
  synthesizeAnswer,
  type DocumentFeedback,
  type AiBaseline,
  type Resolution,
} from '@/lib/api'
import { krwPerUsdc } from '@/lib/browserPaymentConfig'
import { cn } from '@/lib/utils'
import { explorerUrl, openDocuments, PaymentError } from '@/lib/x402'
import { DEVNET_USDC, shortKey, useWallet } from '@/state/wallet'
import { useUi, type Citation, type PaymentContext } from '@/state/ui'

/**
 * The life of one question — the 7 steps the meeting locked, as state.
 *
 *   1 ask  2 search  3 rank  4 hit/miss  5 open call  6 x402  7 accrue
 *
 * Step 4 is the whole service. A human hit ends as paid search; a miss may add
 * zero-price general AI liquidity while keeping the human gap open for a call.
 * Phantom approves a reusable prepaid balance refill only when funds are low. The server agent then pays the
 * selected DBs independently through Pay.sh and returns only paid evidence.
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

type RankedShelf = {
  id: string
  name: string
  accent: string
}

const KRW_PER_USDC = krwPerUsdc(import.meta.env.VITE_KRW_PER_USDC, import.meta.env.PROD)

const STEPS = [
  { n: 2, label: 'Search the shelves', blurb: 'People\u2019s documents, not the web' },
  { n: 3, label: 'Rank the persona web', blurb: 'Relevance, authority, trust, freshness, diversity' },
  { n: 4, label: 'Human coverage', blurb: 'AI bridges a miss; people fill it' },
]

const COUNT_CHOICES = [3, 7, 12]
const PRICE_CHOICES = [0, 300, 500, 800]
const SHELF_ACCENTS = ['#C8552B', '#2F6F8F', '#3E7C59', '#7A5C9E', '#9A6B2F']

function shelfAccent(id: string): string {
  let hash = 0
  for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) >>> 0
  return SHELF_ACCENTS[hash % SHELF_ACCENTS.length]
}

export default function Chat() {
  const { id } = useParams()
  const navigate = useNavigate()
  const {
    chats,
    appendAssistant,
    patchChat,
    placeOrder,
    cancelOrder,
    orders,
    refreshLedger,
    account,
    createChat,
    setMobileSidebar,
  } = useUi()
  const wallet = useWallet()
  const t = useT()
  const chat = chats.find((c) => c.id === id)

  const [phase, setPhase] = useState<Phase>(() =>
    chat?.paymentSession
      ? chat.messages.some((message) => message.settlement?.partial)
        ? 'failed'
        : 'confirm'
      : 'searching',
  )
  const [hits, setHits] = useState<{ shelf: RankedShelf; score: number }[]>([])
  const [pending, setPending] = useState<Citation[]>(
    () => chat?.paymentSession?.docs ?? [],
  )
  const [count, setCount] = useState<number | null>(null)
  const [placedOrderId, setPlacedOrderId] = useState<string | null>(null)
  const [payError, setPayError] = useState<string | null>(null)
  const [mintCopied, setMintCopied] = useState(false)
  const [queryId, setQueryId] = useState<string | null>(
    () => chat?.paymentSession?.queryId ?? null,
  )
  const [resolutionReason, setResolutionReason] = useState<Resolution['reason'] | null>(null)
  const [openCallDraft, setOpenCallDraft] = useState<Resolution['openCall'] | null>(
    null,
  )
  const [aiBaseline, setAiBaseline] = useState<AiBaseline | null>(
    () => chat?.aiBaseline ?? null,
  )
  const [aiBaselineStatus, setAiBaselineStatus] = useState<
    'idle' | 'loading' | 'ready' | 'unavailable'
  >(() => (chat?.aiBaseline ? 'ready' : 'idle'))
  const startedRef = useRef<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const mintCopiedTimeoutRef = useRef<number | null>(null)

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
  const paymentSession = chat?.paymentSession
  const paymentUsesLegacyPaySh = paymentSession?.payer === 'pay.sh'
  const paymentPayerMismatch = Boolean(
    paymentSession?.payer &&
      !paymentUsesLegacyPaySh &&
      wallet.pubkey &&
      paymentSession.payer !== wallet.pubkey,
  )
  const paymentIncomplete = phase === 'failed' && Boolean(paymentSession?.docs.length)

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

  /** Steps 6–7. Reserve prepaid credit, then server-side Pay.sh orchestration. */
  const settle = useCallback(
    async (
      citations: Citation[],
      shelfName: string,
      resolvedQueryId: string | null,
    ) => {
      if (!chatId || !resolvedQueryId) return
      if (!account) {
        navigate(`/login?returnTo=${encodeURIComponent(`/chat/${chatId}`)}`)
        return
      }
      const session = chat?.paymentSession
      if (!session) {
        setPayError('The payment session is gone. Ask the question again.')
        setPhase('failed')
        return
      }
      if (session.payer === 'pay.sh') {
        setPayError('This is an old local Pay.sh session. Start a new query to use server orchestration.')
        setPhase('failed')
        return
      }
      if (!wallet.pubkey) {
        await wallet.connect()
        return
      }
      if (session.payer && session.payer !== wallet.pubkey) {
        setPayError(
          `${t('This question was started from')} ${shortKey(session.payer)}. ${t('The connected wallet is')} ${shortKey(wallet.pubkey)}. ${t('Switch back to open what you already paid for.')}`,
        )
        setPhase('failed')
        return
      }
      const payer = wallet.pubkey
      if (!payer) return
      if (!session.payer) {
        patchChat(chatId, {
          paymentSession: { ...session, payer },
        })
      }
      setPhase('settling')
      setPayError(null)
      try {
        const request = {
          queryId: resolvedQueryId,
          question: prompt ?? '',
          payer,
          accessToken: session.accessToken,
          docs: citations.map((c) => ({
            handle: c.handle,
            shelf: c.shelf,
            price: c.price,
          })),
        }
        const result = await openDocuments(request)
        const openedHandles = new Set(result.citations.map((citation) => citation.handle))
        const remaining = citations.filter(
          (citation) => !openedHandles.has(citation.handle),
        )
        let answer = `${t('Opened')} ${result.citations.length} ${t('documents from the')} ${shelfName} ${t('shelf. Each passage below is quoted as written.')}${result.settlement.partial ? ` ${t('Payment stopped before the rest, so those stayed closed and cost nothing.')}` : ''}`
        if (result.citations.length > 0) {
          try {
            const synthesis = await synthesizeAnswer(
              resolvedQueryId,
              result.citations.map((citation) => citation.handle),
              session.accessToken,
            )
            answer = synthesis.answer
          } catch {
            // Payment and evidence delivery remain successful if synthesis is unavailable.
          }
        }
        appendAssistant(chatId, {
          id: `${chatId}_paid_${Date.now().toString(36)}`,
          role: 'assistant',
          content: answer,
          citations: result.citations,
          settlement: {
            count: result.settlement.count,
            total: result.settlement.total,
            txSig: result.settlement.txSig,
            txSigs: result.settlement.txSigs,
            network: result.settlement.network,
            partial: result.settlement.partial,
            mode: result.settlement.mode,
          },
          paymentContext: {
            queryId: session.queryId,
            accessToken: session.accessToken,
            payer,
          },
        })
        void refreshLedger().catch(() => undefined)
        if (result.settlement.partial && remaining.length) {
          const nextSession = { ...session, payer, docs: remaining }
          patchChat(chatId, { paymentSession: nextSession })
          setPending(remaining)
          setPayError(
            `${result.citations.length} ${result.citations.length === 1 ? t('document opened and paid.') : t('documents opened and paid.')} ${remaining.length} ${t('stayed closed and cost nothing.')}`,
          )
          setPhase('failed')
        } else {
          patchChat(chatId, { paymentSession: undefined })
          setPending([])
          setPhase('answered')
        }
      } catch (e) {
        setPayError(
          e instanceof PaymentError ? e.message : 'The payment did not go through.',
        )
        setPhase('failed')
      }
    },
    [
      account,
      appendAssistant,
      chat?.paymentSession,
      chatId,
      navigate,
      patchChat,
      prompt,
      refreshLedger,
      t,
      wallet,
    ],
  )

  // search → rank → branch. The guard is released in cleanup so StrictMode's
  // remount reschedules instead of leaving the run half-finished.
  useEffect(() => {
    if (!chatId || !prompt || hasAnswer || existingOrder || chat?.paymentSession) return
    if (startedRef.current === chatId) return
    startedRef.current = chatId

    let cancelled = false
    setPhase('searching')
    setHits([])
    setPayError(null)
    setQueryId(null)
    setResolutionReason(null)
    setOpenCallDraft(null)
    setAiBaseline(null)
    setAiBaselineStatus('idle')

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
          seen.add(match.shelfId)
          return [{
            shelf: {
              id: match.shelfId,
              name: match.shelf,
              accent: shelfAccent(match.shelfId),
            },
            score: match.score,
          }]
        })
        setPhase('ranking')
        setHits(ranked.slice(0, 3))
        await new Promise((resolve) => window.setTimeout(resolve, 650))
        if (cancelled) return

        // Step 4 — this is where it splits. Partial coverage is still a miss:
        // the open call asks only for the missing number of answers.
        if (resolution.decision === 'miss') {
          setPhase('ask-order')
          if (resolution.aiBaselineEligible) {
            setAiBaselineStatus('loading')
            void generateAiBaseline(
              resolution.queryId,
              resolution.paymentAccessToken,
            ).then(
              (result) => {
                if (cancelled) return
                if (result.baseline) {
                  setAiBaseline(result.baseline)
                  setAiBaselineStatus('ready')
                  patchChat(chatId, { aiBaseline: result.baseline })
                } else {
                  setAiBaselineStatus('unavailable')
                }
              },
              () => {
                if (!cancelled) setAiBaselineStatus('unavailable')
              },
            )
          }
          return
        }
        const cites: Citation[] = resolution.matches.map((match) => ({
          handle: match.handle,
          shelf: match.shelf,
          excerpt: '',
          price: match.priceKrw,
        }))
        patchChat(chatId, {
          paymentSession: {
            queryId: resolution.queryId,
            accessToken: resolution.paymentAccessToken,
            docs: cites,
            shelfName: cites[0]?.shelf ?? 'Unsorted',
          },
        })
        setPending(cites)
        setPhase('confirm')
      } catch (error) {
        if (cancelled) return
        setPayError(error instanceof Error ? error.message : 'The search did not finish. Ask again.')
        setPhase('failed')
      }
    }
    void run()

    return () => {
      cancelled = true
      startedRef.current = null
    }
  }, [chat?.filters, chat?.paymentSession, chatId, existingOrder, prompt, hasAnswer, patchChat])

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
          content:
            existingOrder.escrowMode === 'x402_solana_escrow'
              ? 'An answer to your open call arrived. Your reserved escrow holds its Devnet USDC share as a payout claim for the author.'
              : 'An answer to your open call arrived at ₩0, through the off-chain call ledger.',
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
            network:
              existingOrder.escrowMode === 'x402_solana_escrow'
                ? (existingOrder.escrowNetwork ?? 'devnet')
                : 'sandbox-escrow',
            mode:
              existingOrder.escrowMode === 'x402_solana_escrow'
                ? 'open_call_escrow'
                : undefined,
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
            aria-label={t('Open sidebar')}
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
          {t('Open calls')}
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
                  {t(m.content)}
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
                        {m.paymentContext ? (
                          <FeedbackActions
                            citation={c}
                            context={m.paymentContext}
                          />
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}

                {m.settlement ? (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[4px] bg-foreground/[0.04] px-3 py-2 font-mono text-xs text-muted-foreground">
                    <Coins className="size-3.5" />
                    <span>
                      {m.settlement.count} {t('opens')} ·{' '}
                      <span className="tabular-nums text-foreground">
                        ₩{m.settlement.total.toLocaleString()}
                      </span>
                    </span>
                    <span className="text-muted-foreground/60">
                      {m.settlement.network === 'demo'
                        ? t('off-chain application ledger · token settlement disabled')
                        : m.settlement.network === 'sandbox-escrow'
                          ? t('zero-price call · no token transfer')
                        : m.settlement.network === 'offline'
                          ? t('offline preview · no payment sent')
                        : m.settlement.mode === 'open_call_escrow'
                          ? t('Devnet escrow · payout claim created for the author')
                        : m.settlement.mode === 'bundle_escrow'
                          ? t('legacy x402 bundle · each author’s share is claimable')
                        : m.settlement.mode === 'pay_sh_direct'
                          ? t('local Pay.sh · paid only the documents SHELF opened')
                        : m.settlement.mode === 'pay_sh_orchestrated'
                          ? t('prepaid balance · SHELF paid each author through Pay.sh')
                          : t('settled through x402 · unopened documents cost nothing')}
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

          {!hasAnswer || paymentIncomplete ? (
            <div className="flex flex-col gap-4 rounded-[6px] border border-border bg-card p-4">
              <TraceSteps phase={phase} hits={hits} />

              {phase === 'confirm' ? (
                <Branch
                  title={`${pending.length} ${t('documents already answer this.')}`}
                  body={`${t('No open call needed. Opening all')} ${pending.length} ${t('costs')} ₩${total.toLocaleString()}${t(', which settles as')} ${estimatedUsdc.toFixed(6)} ${t('USDC on Solana.')} ${paymentUsesLegacyPaySh ? t('This old local Pay.sh session cannot continue. Ask again to start a new one.') : t('That amount is reserved from your prepaid USDC balance. Phantom appears only for the first refill, or when the balance runs low; SHELF then pays each author through Pay.sh.')}`}
                >
                  <div className="w-full rounded-[4px] bg-foreground/[0.04] px-3 py-2 font-mono text-[10px] uppercase leading-relaxed tracking-[0.8px] text-muted-foreground">
                    {t('One-time wallet proof · refill only when low · no delegate permission or browser helper key. Verify Devnet USDC mint')}{' '}
                    <span className="text-foreground" title={DEVNET_USDC}>
                      {shortKey(DEVNET_USDC)}
                    </span>.
                  </div>
                  <div className="flex w-full items-center justify-between gap-3 rounded-[4px] bg-foreground/[0.04] px-3 py-2 font-mono text-[10px] uppercase leading-relaxed tracking-[0.8px] text-muted-foreground">
                    <span>
                      {t('Phantom may label this token “Unknown” — Devnet USDC has no on-chain name. Match the mint before approving.')}
                    </span>
                    <Button
                      type="button"
                      variant="monoGhost"
                      size="monoSm"
                      className="shrink-0"
                      onClick={() => {
                        void navigator.clipboard?.writeText(DEVNET_USDC)
                        setMintCopied(true)
                        if (mintCopiedTimeoutRef.current !== null) {
                          window.clearTimeout(mintCopiedTimeoutRef.current)
                        }
                        mintCopiedTimeoutRef.current = window.setTimeout(() => {
                          setMintCopied(false)
                          mintCopiedTimeoutRef.current = null
                        }, 1600)
                      }}
                    >
                      {mintCopied ? t('Mint copied') : t('Copy mint')}
                    </Button>
                  </div>
                  {!account ? (
                    <Button
                      variant="mono"
                      size="mono"
                      onClick={() =>
                        navigate(
                          `/login?returnTo=${encodeURIComponent(`/chat/${chatId}`)}`,
                        )
                      }
                    >
                      {t('Sign in to pay')}
                    </Button>
                  ) : !paymentUsesLegacyPaySh && wallet.pubkey && !paymentPayerMismatch ? (
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
                      {t('Open with prepaid balance')}
                    </Button>
                  ) : (
                    <Button
                      variant="mono"
                      size="mono"
                      onClick={() => {
                        if (paymentUsesLegacyPaySh) {
                          const next = createChat(prompt ?? '', chat.filters)
                          navigate(`/chat/${next}`)
                        } else {
                          void wallet.connect()
                        }
                      }}
                    >
                      {paymentUsesLegacyPaySh
                        ? t('Ask again to start a new one')
                        : paymentPayerMismatch
                          ? t('Switch to the original wallet')
                          : t('Connect a wallet to pay')}
                    </Button>
                  )}
                  <Button
                    variant="monoMuted"
                    size="mono"
                    onClick={() => setPhase('ask-order')}
                  >
                    {t('Post a call instead')}
                  </Button>
                </Branch>
              ) : null}

              {phase === 'ask-order' ? (
                <Branch
                  title={
                    resolutionReason === 'insufficient_coverage'
                      ? t('The shelves are thin here.')
                      : resolutionReason === 'budget_too_low'
                        ? t('People have written this, above your price.')
                        : t('Nothing on the shelves has lived this yet.')
                  }
                  body={
                    resolutionReason === 'insufficient_coverage'
                      ? t('Documents exist here, but too few to answer the way you asked. Post an open call for the rest?')
                      : resolutionReason === 'budget_too_low'
                        ? t('Documents exist here, but they cost more than your budget. Post an open call at a price you name?')
                        : t('An open call goes to people who would know. You name what one answer is worth.')
                  }
                >
                  {aiBaselineStatus === 'loading' ? (
                    <div className="w-full rounded-[5px] border border-[#6D5BD0]/20 bg-[#6D5BD0]/[0.04] p-4">
                      <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[1px] text-[#5540BE]">
                        <Loader2 className="size-3 animate-spin" />
                        {t('AI liquidity · preparing general context')}
                      </div>
                      <p className="mt-2 text-sm leading-6 text-muted-foreground">
                        {t('This will not count as human coverage or become a sellable document.')}
                      </p>
                    </div>
                  ) : null}
                  {aiBaseline ? <AiBaselineCard baseline={aiBaseline} /> : null}
                  {aiBaselineStatus === 'unavailable' ? (
                    <div className="w-full rounded-[4px] border border-border px-3 py-2 text-xs leading-5 text-muted-foreground">
                      {t('The general AI baseline is unavailable. The human call remains available and unchanged.')}
                    </div>
                  ) : null}
                  <Button
                    variant="mono"
                    size="mono"
                    onClick={() => setPhase('ask-count')}
                  >
                    {t('Ask them')}
                  </Button>
                  <Button
                    variant="monoMuted"
                    size="mono"
                    onClick={() => setPhase('declined')}
                  >
                    {t('No thanks')}
                  </Button>
                </Branch>
              ) : null}

              {phase === 'ask-count' ? (
                <Branch
                  title={
                    openCallDraft?.existingMatches
                      ? t('How many more people?')
                      : t('How many people?')
                  }
                  body={
                    openCallDraft?.existingMatches
                      ? `${openCallDraft.existingMatches} ${t('documents already answer part of this.')} ${openCallDraft.answersNeeded} ${t('more fills the')} ${openCallDraft.targetAnswers} ${t('you asked for.')}`
                      : t('More answers means you see where they start to disagree.')
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
                  title={t('What do you want to pay per answer?')}
                  body={t('₩0 still gets answers, slower. You pay what you name here once per answer you accept.')}
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
                          navigate(
                            `/login?returnTo=${encodeURIComponent(`/chat/${chatId}`)}`,
                          )
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
                                : 'The call was not posted and nothing left your wallet.',
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
                  title={t('Call posted.')}
                  body={`${placedOrder.target} ${t('answers ·')} ₩${placedOrder.unitPrice.toLocaleString()} ${t('each.')} ₩${placedOrder.escrowRemainingKrw?.toLocaleString() ?? (placedOrder.target * placedOrder.unitPrice).toLocaleString()} ${t('is')} ${placedOrder.escrowMode === 'x402_solana_escrow' ? t('held in Devnet USDC escrow on one Phantom approval') : t('tracked as zero-price, off-chain call credit')}. ${t('Each answer you accept pays its author from that, and whatever is left comes back.')}`}
                >
                  <Button
                    variant="mono"
                    size="mono"
                    onClick={() => navigate('/dashboard')}
                  >
                    {t('See my open call')}
                  </Button>
                  <Button
                    variant="monoMuted"
                    size="mono"
                    onClick={() =>
                      void cancelOrder(placedOrder.id).then(() => setPhase('declined'))
                    }
                  >
                    {t('Cancel and refund')}
                  </Button>
                </Branch>
              ) : null}

              {phase === 'settling' ? (
                <Branch
                  title={t('SHELF is opening the documents…')}
                  body={t('The question is reserved against your prepaid balance. SHELF checks each 402 price and recipient, pays the author, and returns only the passages it paid for. Phantom appears only if the balance needs a refill. You can close this tab — the job keeps running.')}
                />
              ) : null}

              {phase === 'failed' ? (
                <Branch
                  title={queryId ? t('The payment did not go through.') : t('SHELF could not reach the shelves.')}
                  body={t(
                    payError ??
                      'The documents stayed closed. Retry picks up the same job and the same reservation, so nothing is paid twice.',
                  )}
                >
                  {queryId && pending.length && !paymentPayerMismatch ? (
                    <Button
                      variant="mono"
                      size="mono"
                      onClick={() =>
                        void settle(
                          pending,
                          paymentSession?.shelfName ?? pending[0]?.shelf ?? 'Unsorted',
                          queryId,
                        )
                      }
                    >
                      {t('Retry the')} {pending.length} {t('that stayed closed')}
                    </Button>
                  ) : null}
                  {paymentPayerMismatch ? (
                    <Button
                      variant="monoMuted"
                      size="mono"
                      onClick={() => {
                        const next = createChat(prompt ?? '', chat.filters)
                        navigate(`/chat/${next}`)
                      }}
                    >
                      {t('Ask again with this wallet')}
                    </Button>
                  ) : null}
                </Branch>
              ) : null}

              {phase === 'declined' ? (
                <Branch
                  title={t('Understood.')}
                  body={t('No call was posted and nothing left your wallet. Ask again at a different price any time.')}
                />
              ) : null}
            </div>
          ) : null}

          {hasAnswer && !paymentIncomplete ? (
            <p className="text-center font-mono text-xs uppercase tracking-[1px] text-muted-foreground">
              {t('Each author was paid onchain · these documents can auto-match again')}
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

function AiBaselineCard({ baseline }: { baseline: AiBaseline }) {
  const t = useT()
  return (
    <section className="w-full rounded-[6px] border border-[#6D5BD0]/25 bg-[#6D5BD0]/[0.045] p-4 text-left">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-mono text-[10px] font-medium uppercase tracking-[1px] text-[#5540BE]">
          <Sparkles className="size-3" />
          {t('AI general baseline')}
        </div>
        <span className="rounded-full border border-[#6D5BD0]/20 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.7px] text-[#6D5BD0]">
          {t('Free · not human evidence')}
        </span>
      </div>
      <p className="mt-3 text-sm leading-6 text-foreground/85">
        {baseline.orientation}
      </p>
      <ul className="mt-3 space-y-1.5 text-[13px] leading-5 text-foreground/75">
        {baseline.generalPoints.map((point) => (
          <li key={point} className="flex gap-2">
            <span aria-hidden className="text-[#6D5BD0]">·</span>
            <span>{point}</span>
          </li>
        ))}
      </ul>
      <div className="mt-4 border-t border-[#6D5BD0]/15 pt-3">
        <p className="font-mono text-[9px] font-medium uppercase tracking-[1px] text-muted-foreground">
          {t('Still needs people')}
        </p>
        <ul className="mt-2 space-y-1.5 text-[13px] leading-5 text-foreground/75">
          {baseline.humanGaps.map((gap) => (
            <li key={gap} className="flex gap-2">
              <span aria-hidden className="text-[#C24D32]">—</span>
              <span>{gap}</span>
            </li>
          ))}
        </ul>
      </div>
      <p className="mt-3 font-mono text-[9px] uppercase leading-4 tracking-[0.7px] text-muted-foreground">
        {t('₩0 · question sent to Gemini on Vertex AI without private shelf passages · cannot be bought or resold · never enters Shelf ranking')}
      </p>
    </section>
  )
}

function AgentLabel() {
  return (
    <div className="flex items-center gap-2">
      <span className="flex size-6 items-center justify-center rounded-[2px] bg-foreground">
        <img className="size-3.5 invert" src="/OBOLUS-MARK-SM.svg" alt="" />
      </span>
      <span className="font-mono text-xs font-medium uppercase tracking-[1px] text-muted-foreground">
        SHELF
      </span>
    </div>
  )
}

function FeedbackActions({
  citation,
  context,
}: {
  citation: Citation
  context: PaymentContext
}) {
  const t = useT()
  const [recorded, setRecorded] = useState<DocumentFeedback | null>(null)
  const [reporting, setReporting] = useState(false)
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const send = async (
    outcome: 'helpful' | 'not_helpful' | 'report',
  ) => {
    if (submitting || recorded) return
    if (outcome === 'report' && reason.trim().length < 20) return
    setSubmitting(true)
    setError(null)
    try {
      const feedback = await submitDocumentFeedback(
        context.queryId,
        citation.handle,
        context.payer,
        context.accessToken,
        outcome,
        outcome === 'report' ? reason.trim() : undefined,
      )
      setRecorded(feedback)
      setReporting(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That did not save. Press it again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (recorded) {
    return (
      <p className="mt-3 border-t border-border/70 pt-2 font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">
        {recorded.outcome === 'report'
          ? t('Report sent · under review')
          : `${t(recorded.outcome.replace('_', ' '))} · ${t('recorded')}`}
      </p>
    )
  }

  return (
    <div className="mt-3 border-t border-border/70 pt-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 font-mono text-[9px] uppercase tracking-[1px] text-muted-foreground">
          {t('You paid for this passage')}
        </span>
        <Button
          variant="monoGhost"
          size="monoSm"
          disabled={submitting}
          onClick={() => void send('helpful')}
        >
          <ThumbsUp className="size-3" /> {t('Helpful')}
        </Button>
        <Button
          variant="monoGhost"
          size="monoSm"
          disabled={submitting}
          onClick={() => void send('not_helpful')}
        >
          <ThumbsDown className="size-3" /> {t('Not helpful')}
        </Button>
        <Button
          variant="monoGhost"
          size="monoSm"
          disabled={submitting}
          onClick={() => setReporting((value) => !value)}
        >
          <Flag className="size-3" /> {t('Report')}
        </Button>
      </div>
      {reporting ? (
        <div className="mt-2 grid gap-2">
          <textarea
            rows={3}
            maxLength={1000}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder={t('Name what is wrong — made-up facts, copied text, low effort, abuse. 20 to 1000 characters.')}
            className="w-full resize-y rounded-[3px] border border-border bg-background p-2 text-sm outline-none focus:ring-1 focus:ring-foreground/30"
          />
          <Button
            variant="mono"
            size="monoSm"
            className="justify-self-start"
            disabled={submitting || reason.trim().length < 20}
            onClick={() => void send('report')}
          >
            {submitting ? <Loader2 className="size-3 animate-spin" /> : null}
            {t('Send report')}
          </Button>
        </div>
      ) : null}
      {error ? <p className="mt-2 text-xs text-destructive">{t(error)}</p> : null}
    </div>
  )
}

function TraceSteps({
  phase,
  hits,
}: {
  phase: Phase
  hits: { shelf: RankedShelf; score: number }[]
}) {
  // Search and ranking are the only long-running trace phases. Once ranking
  // resolves, step 4 has made its hit/miss decision; payment, open-call, and
  // failure states are downstream outcomes and must not leave step 4 spinning.
  const reached = phase === 'searching' ? 0 : phase === 'ranking' ? 1 : STEPS.length
  const icons = [Search, SlidersHorizontal, Coins]
  const t = useT()

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
                {t('STEP')} {s.n} · {t(s.label)}
              </span>
              <span className="text-sm leading-snug text-muted-foreground">
                {t(s.blurb)}
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
