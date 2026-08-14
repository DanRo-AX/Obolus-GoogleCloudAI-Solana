import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import {
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  ChevronDown,
  Copy,
  Loader2,
  RefreshCw,
  Search,
  UserRound,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge, Banner, Chip } from '@/components/ui/primitives'
import { useT } from '@/i18n'
import type { EarningEvent } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useUi, type Chat } from '@/state/ui'
import { DEVNET_USDC, shortKey } from '@/state/wallet'

/**
 * 내역 — the unified ledger. Every wallet-to-wallet transfer this account
 * ever took part in, whichever direction it moved.
 *
 * `getEarnings()` already itemises money received as an answerer: one
 * `EarningEvent` per settlement. Archive.tsx already itemises money paid as
 * an asker, off `chat.messages[].settlement` / `.citations` — the exact same
 * fields, just walked per message here instead of aggregated per
 * conversation, so one row here is always one real transaction, not a
 * thread summary. Both feeds are merged, sorted by time, and rendered
 * through the same row so "who paid whom" reads as one ledger instead of
 * two separate pages the same money is scattered across.
 */

const USDC_DECIMALS = 1_000_000

type Direction = 'received' | 'sent'

type LedgerDoc = { handle: string; shelf: string; price: number }

type LedgerRow = {
  id: string
  direction: Direction
  createdAt: number
  amountKrw: number
  amountAtomic?: string
  network?: string
  txSig?: string
  txSigs?: string[]
  /** The one wallet on this transaction we actually know, if any. */
  knownWallet?: string
  docs: LedgerDoc[]
  documentHandle?: string
  contentHash?: string
  settlementId?: string
  memoryId?: string
  payoutClaimId?: string
  payoutStatus?: EarningEvent['payoutStatus']
  payoutClaimStatus?: string
  source?: EarningEvent['source']
  availableAt?: number
  chatId?: string
  chatTitle?: string
  partial?: boolean
}

function receivedRows(
  events: EarningEvent[],
  contentHashByMemoryId: Map<string, string>,
): LedgerRow[] {
  return events.map((event) => ({
    id: `earning:${event.id}`,
    direction: 'received',
    createdAt: event.createdAt,
    amountKrw: event.amountKrw,
    amountAtomic: event.payoutAmountAtomic,
    // No network is stored per earning event — every settlement in this app
    // is Solana Devnet, the same assumption Archive.tsx and Memory.tsx make
    // when they hard-code `cluster=devnet` on the identical explorer link.
    network: event.payoutTransactionSignature ? 'devnet' : undefined,
    txSig: event.payoutTransactionSignature,
    knownWallet: event.recipientWallet,
    docs: [],
    documentHandle: event.documentHandle,
    contentHash: event.memoryId
      ? contentHashByMemoryId.get(event.memoryId)
      : undefined,
    settlementId: event.settlementId,
    memoryId: event.memoryId,
    payoutClaimId: event.payoutClaimId,
    payoutStatus: event.payoutStatus,
    payoutClaimStatus: event.payoutClaimStatus,
    source: event.source,
    availableAt: event.availableAt,
  }))
}

function sentRows(chats: Chat[]): LedgerRow[] {
  const rows: LedgerRow[] = []
  for (const chat of chats) {
    for (const message of chat.messages) {
      if (!message.settlement) continue
      rows.push({
        id: `sent:${chat.id}:${message.id}`,
        direction: 'sent',
        // Messages carry no timestamp of their own, only the chat does —
        // every settlement in a conversation inherits the chat's createdAt,
        // same as Archive.tsx's per-thread sort.
        createdAt: chat.createdAt,
        amountKrw: message.settlement.total,
        network: message.settlement.network,
        txSig: message.settlement.txSig,
        txSigs: message.settlement.txSigs,
        knownWallet: message.paymentContext?.payer,
        docs: (message.citations ?? []).map((citation) => ({
          handle: citation.handle,
          shelf: citation.shelf,
          price: citation.price,
        })),
        chatId: chat.id,
        chatTitle: chat.title,
        partial: message.settlement.partial,
      })
    }
  }
  return rows
}

function formatUsdc(atomic: string): string | null {
  const n = Number(atomic)
  if (!Number.isFinite(n)) return null
  return (n / USDC_DECIMALS).toFixed(6)
}

function statusChip(
  row: LedgerRow,
  t: (en: string) => string,
): { text: string; className: string } {
  if (row.direction === 'sent') {
    return row.partial
      ? { text: t('partial'), className: 'bg-amber-500/10 text-amber-700' }
      : { text: t('Settled'), className: 'bg-foreground/10 text-foreground' }
  }
  switch (row.payoutStatus) {
    case 'held':
      return { text: t('held 14d'), className: 'bg-amber-500/10 text-amber-700' }
    case 'onchain':
      return {
        text: t('paid onchain'),
        className: 'bg-emerald-500/10 text-emerald-700',
      }
    case 'claimable':
      return {
        text: t(row.payoutClaimStatus ?? 'payout pending'),
        className: 'bg-sky-500/10 text-sky-700',
      }
    case 'paid':
      return {
        text: t('payout confirmed'),
        className: 'bg-emerald-500/10 text-emerald-700',
      }
    default:
      return { text: t('accrued'), className: 'bg-foreground/10 text-muted-foreground' }
  }
}

function subjectText(row: LedgerRow, t: (en: string) => string): string {
  if (row.direction === 'sent') return row.chatTitle ?? t('Untitled question')
  if (row.documentHandle) return row.documentHandle
  return t(row.source ? row.source.replaceAll('_', ' ') : 'seed')
}

/** Not a component, so the translator arrives as an argument, not a hook. */
function relative(ts: number, t: (en: string) => string) {
  const min = Math.round((Date.now() - ts) / 60000)
  if (min < 60) return `${Math.max(1, min)}${t('m ago')}`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}${t('h ago')}`
  return `${Math.round(hr / 24)}${t('d ago')}`
}

/**
 * The tab/route-shared body. Rendered full-page at /transactions, and again
 * as the "내역" tab inside Memory — same component, same state, same t()
 * strings, just a different wrapper around it.
 */
export function TransactionsPanel() {
  const { chats, earnings, memory, account, profile, authReady, refreshLedger } = useUi()
  const t = useT()
  const [q, setQ] = useState('')
  const [direction, setDirection] = useState<'all' | Direction>('all')
  const [openId, setOpenId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      await refreshLedger()
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : t('The ledger did not load. Try it again.'),
      )
    } finally {
      setLoading(false)
    }
  }, [refreshLedger, t])

  useEffect(() => {
    if (!authReady || !account) return
    void load()
    // load() depends on refreshLedger/t, both stable-ish; re-run when the
    // signed-in account actually changes, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authReady, account])

  const contentHashByMemoryId = useMemo(() => {
    const map = new Map<string, string>()
    for (const entry of memory) {
      if (entry.contentHash) map.set(entry.id, entry.contentHash)
    }
    return map
  }, [memory])

  const allRows = useMemo(
    () =>
      [...receivedRows(earnings?.events ?? [], contentHashByMemoryId), ...sentRows(chats)].sort(
        (a, b) => b.createdAt - a.createdAt,
      ),
    [earnings, chats, contentHashByMemoryId],
  )

  const totals = useMemo(
    () => ({
      received: allRows
        .filter((r) => r.direction === 'received')
        .reduce((sum, r) => sum + r.amountKrw, 0),
      sent: allRows.filter((r) => r.direction === 'sent').reduce((sum, r) => sum + r.amountKrw, 0),
    }),
    [allRows],
  )

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return allRows
      .filter((r) => (direction === 'all' ? true : r.direction === direction))
      .filter((r) =>
        needle
          ? Boolean(r.knownWallet?.toLowerCase().includes(needle)) ||
            Boolean(r.documentHandle?.toLowerCase().includes(needle)) ||
            Boolean(r.chatTitle?.toLowerCase().includes(needle)) ||
            r.docs.some(
              (d) =>
                d.handle.toLowerCase().includes(needle) || d.shelf.toLowerCase().includes(needle),
            )
          : true,
      )
  }, [allRows, direction, q])

  if (!authReady) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    )
  }
  if (!account) return <Navigate to="/login" replace />

  return (
    <div className="space-y-6">
      <div className="flex min-h-8 flex-wrap items-center justify-between gap-4">
        <h1 className="font-sans text-base font-medium">{t('Transactions')}</h1>
        <div className="flex items-center gap-5 font-mono text-xs uppercase tracking-[1px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <ArrowDownLeft className="size-3.5 text-[#0F766E]" />
            <span className="tabular-nums text-foreground">
              ₩{totals.received.toLocaleString()}
            </span>
            {t(' received')}
          </span>
          <span className="flex items-center gap-1.5">
            <ArrowUpRight className="size-3.5" />
            <span className="tabular-nums text-foreground">₩{totals.sent.toLocaleString()}</span>
            {t(' sent')}
          </span>
          <Button
            variant="monoGhost"
            size="monoSm"
            disabled={loading}
            onClick={() => void load()}
          >
            <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
            {t('Refresh')}
          </Button>
        </div>
      </div>

      <p className="max-w-2xl text-[15px] leading-7 text-muted-foreground">
        {t(
          'What you were paid when your documents got opened, and what you paid to open another document, in one ledger.',
        )}
      </p>

      {!profile ? (
        <Banner tone="neutral" className="flex flex-wrap items-center gap-3 px-4 py-3">
          <UserRound className="size-4 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {t(
              'Set up a profile and a payout wallet, and money you earn for an opened document starts landing here.',
            )}
          </p>
          <Button asChild variant="monoMuted" size="monoSm" className="ml-auto">
            <Link to="/onboarding">{t('Set up profile')}</Link>
          </Button>
        </Banner>
      ) : null}

      {error ? (
        <div className="flex flex-wrap items-center gap-3 rounded-[4px] border border-destructive/30 bg-destructive/5 px-3 py-2">
          <p className="text-sm text-destructive">{error}</p>
          <Button
            variant="monoMuted"
            size="monoSm"
            className="ml-auto"
            disabled={loading}
            onClick={() => void load()}
          >
            {t('Refresh')}
          </Button>
        </div>
      ) : null}

      {/* controls ----------------------------------------------------- */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('Search wallets and documents')}
            className="h-9 w-full rounded-[2px] border border-border bg-transparent pl-9 pr-3 text-sm outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-foreground/40"
          />
        </div>
        <Chip active={direction === 'all'} onClick={() => setDirection('all')}>
          {t('All')}
        </Chip>
        <Chip active={direction === 'received'} onClick={() => setDirection('received')}>
          {t('Received')}
        </Chip>
        <Chip active={direction === 'sent'} onClick={() => setDirection('sent')}>
          {t('Sent')}
        </Chip>
        <span className="ml-auto font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">
          {rows.length}
          {rows.length === 1 ? t(' transaction') : t(' transactions')}
        </span>
      </div>

      {loading && allRows.length === 0 ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-[72px] animate-pulse rounded-[6px] border border-border bg-card"
            />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-[18vh] text-center">
          <h2 className="font-sans text-lg font-medium">
            {allRows.length === 0 ? t('Nothing in your ledger yet') : t('No transaction matches')}
          </h2>
          <p className="max-w-[360px] text-sm leading-relaxed text-muted-foreground">
            {allRows.length === 0
              ? t(
                  'Answer a question and get paid, or open a document and pay for it. Either one lands here the moment it settles.',
                )
              : t('Try a different word, or clear the direction filter.')}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map((row) => (
            <TransactionRow
              key={row.id}
              row={row}
              open={openId === row.id}
              onToggle={() => setOpenId((id) => (id === row.id ? null : row.id))}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/** /transactions still resolves on its own — same panel, full-page wrapper. */
export default function Transactions() {
  return (
    <div className="page-enter flex-1 overflow-y-auto">
      <div className="p-4 sm:p-6">
        <TransactionsPanel />
      </div>
    </div>
  )
}

function TransactionRow({
  row,
  open,
  onToggle,
}: {
  row: LedgerRow
  open: boolean
  onToggle: () => void
}) {
  const t = useT()
  const received = row.direction === 'received'
  const status = statusChip(row, t)
  const usdc = row.amountAtomic ? formatUsdc(row.amountAtomic) : null

  return (
    <div className="overflow-hidden rounded-[6px] border border-border bg-card">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full cursor-pointer flex-wrap items-center gap-3 p-4 text-left transition-colors hover:bg-foreground/[0.02] sm:p-5"
      >
        <span
          className={cn(
            'flex size-8 shrink-0 items-center justify-center rounded-full',
            received ? 'bg-[#0F766E]/10 text-[#0F766E]' : 'bg-foreground/[0.06] text-muted-foreground',
          )}
        >
          {received ? <ArrowDownLeft className="size-4" /> : <ArrowUpRight className="size-4" />}
        </span>

        <div className="min-w-0 flex-1">
          <p className="font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">
            {relative(row.createdAt, t)} · {received ? t('Received') : t('Sent')}
            {row.docs.length ? ` · ${row.docs.length}${t(' opened')}` : ''}
          </p>
          <p className="mt-1.5 truncate text-[15px] leading-relaxed">{subjectText(row, t)}</p>
          <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            {row.knownWallet ? (
              <span className="font-mono text-foreground/80">{shortKey(row.knownWallet)}</span>
            ) : null}
            <span>
              {row.knownWallet ? '· ' : ''}
              {received ? t('asker undisclosed') : t('author undisclosed')}
            </span>
          </p>
        </div>

        <span
          className={cn(
            'shrink-0 rounded-[2px] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[1px]',
            status.className,
          )}
        >
          {status.text}
        </span>

        <div className="shrink-0 text-right">
          <p
            className={cn(
              'font-mono text-sm tabular-nums',
              received ? 'text-[#0F766E]' : 'text-foreground',
            )}
          >
            {received ? '+' : '-'}₩{row.amountKrw.toLocaleString()}
          </p>
          {usdc ? (
            <p className="font-mono text-[10px] tabular-nums text-muted-foreground">{usdc} USDC</p>
          ) : null}
        </div>

        <ChevronDown
          className={cn(
            'size-3.5 shrink-0 text-muted-foreground transition-transform',
            open && 'rotate-180',
          )}
        />
      </button>

      {open ? <TransactionDetail row={row} /> : null}
    </div>
  )
}

function DetailField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">
        {label}
      </p>
      <div className="mt-1 min-w-0 text-sm text-foreground/90">{children}</div>
    </div>
  )
}

function TransactionDetail({ row }: { row: LedgerRow }) {
  const t = useT()
  const [copiedSig, setCopiedSig] = useState<string | null>(null)
  const copyTimeoutRef = useRef<number | null>(null)

  const copy = (text: string) => {
    void navigator.clipboard?.writeText(text)
    setCopiedSig(text)
    if (copyTimeoutRef.current !== null) window.clearTimeout(copyTimeoutRef.current)
    copyTimeoutRef.current = window.setTimeout(() => {
      setCopiedSig(null)
      copyTimeoutRef.current = null
    }, 1500)
  }

  const usdc = row.amountAtomic ? formatUsdc(row.amountAtomic) : null
  const status = statusChip(row, t)
  const signatures = row.txSigs?.length ? row.txSigs : row.txSig ? [row.txSig] : []
  const reference = [row.settlementId, row.memoryId, row.payoutClaimId].filter(Boolean).join(' · ')

  return (
    <div className="space-y-4 border-t border-border bg-muted-2/40 px-4 py-4 sm:px-5">
      <DetailField label={t('Transaction signature')}>
        {signatures.length ? (
          <div className="flex flex-col gap-1.5">
            {signatures.map((sig) => (
              <div key={sig} className="flex flex-wrap items-center gap-2">
                <span className="break-all font-mono text-xs">{sig}</span>
                <button
                  type="button"
                  onClick={() => copy(sig)}
                  className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-[2px] border border-border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[1px] text-muted-foreground transition-colors hover:text-foreground"
                >
                  {copiedSig === sig ? <Check className="size-3" /> : <Copy className="size-3" />}
                  {copiedSig === sig ? t('Copied') : t('Copy')}
                </button>
              </div>
            ))}
          </div>
        ) : (
          <span className="text-muted-foreground/70">{t('not recorded')}</span>
        )}
      </DetailField>

      <div className="grid gap-4 sm:grid-cols-2">
        <DetailField label={t('Network')}>
          {row.network ?? <span className="text-muted-foreground/70">{t('not recorded')}</span>}
        </DetailField>
        <DetailField label={t('Asset')}>
          {row.txSig || row.amountAtomic ? (
            <span className="font-mono text-xs" title={DEVNET_USDC}>
              Devnet USDC · {shortKey(DEVNET_USDC)}
            </span>
          ) : (
            <span className="text-muted-foreground/70">{t('not recorded')}</span>
          )}
        </DetailField>
        <DetailField label={t('Amount')}>
          <span className="font-mono text-sm tabular-nums">
            ₩{row.amountKrw.toLocaleString()}
            {usdc ? ` · ${usdc} USDC` : ''}
          </span>
        </DetailField>
        <DetailField label={t('Status')}>
          <span
            className={cn(
              'inline-flex w-fit rounded-[2px] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[1px]',
              status.className,
            )}
          >
            {status.text}
          </span>
        </DetailField>
        <DetailField label={t('Created')}>{new Date(row.createdAt).toLocaleString()}</DetailField>
        {row.availableAt ? (
          <DetailField label={t('Available')}>
            {new Date(row.availableAt).toLocaleString()}
          </DetailField>
        ) : null}
      </div>

      {row.documentHandle ? (
        <DetailField label={t('Document')}>
          <span className="font-mono text-xs">{row.documentHandle}</span>
        </DetailField>
      ) : null}

      {row.contentHash ? (
        <DetailField label={t('Content hash')}>
          <span className="break-all font-mono text-xs">{row.contentHash}</span>
        </DetailField>
      ) : null}

      {row.docs.length ? (
        <DetailField label={t('Documents opened')}>
          <div className="flex flex-col gap-1.5">
            {row.docs.map((d, i) => (
              <div key={`${d.handle}-${i}`} className="flex flex-wrap items-baseline gap-3">
                <span className="font-mono text-[11px] uppercase tracking-[1px] text-muted-foreground">
                  {d.handle}
                </span>
                <Badge className="truncate px-1.5 py-0 uppercase tracking-[1px]">{d.shelf}</Badge>
                <span className="ml-auto font-mono text-xs tabular-nums">
                  ₩{d.price.toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        </DetailField>
      ) : null}

      {row.chatId ? (
        <DetailField label={t('Conversation')}>
          <Link
            to={`/chat/${row.chatId}`}
            className="text-sm text-foreground underline decoration-dotted underline-offset-4"
          >
            {row.chatTitle ?? t('Open the conversation')}
          </Link>
        </DetailField>
      ) : null}

      {reference ? (
        <DetailField label={t('Reference')}>
          <span className="break-all font-mono text-[11px] text-muted-foreground">{reference}</span>
        </DetailField>
      ) : null}

      {signatures[0] ? (
        <a
          href={`https://explorer.solana.com/tx/${signatures[0]}?cluster=${row.network ?? 'devnet'}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[1px] text-foreground underline decoration-dotted underline-offset-4 hover:text-foreground/80"
        >
          {t('View on explorer')}
          <ArrowUpRight className="size-3" />
        </a>
      ) : null}
    </div>
  )
}
