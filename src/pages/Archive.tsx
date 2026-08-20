import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowUpRight,
  ChevronDown,
  Search,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge, Chip } from '@/components/ui/primitives'
import { SettlementInvoiceDialog } from '@/components/SettlementInvoiceDialog'
import { useT } from '@/i18n'
import { formatUsdcFromKrw } from '@/lib/usdc'
import type { SettlementPreviewEnvelope } from '@/lib/api'
import { useUi, type Chat } from '@/state/ui'

/**
 * Everything you have asked, with what it cost sitting on the same row.
 *
 * A plain list of conversation titles would be a browser history. What makes
 * this worth opening is that a question and its receipt are the same object
 * here: the passages you paid for, who wrote them, and the transaction that
 * settled it all hang off the conversation that bought them.
 */

type Row = {
  chat: Chat
  /** Documents opened across the whole conversation. */
  docs: { handle: string; shelf: string; price: number }[]
  spent: number
  txSig?: string
  network?: string
  receipts: {
    invoice: SettlementPreviewEnvelope
    txSigs: string[]
    network?: string
    partial?: boolean
    mode?: NonNullable<Chat['messages'][number]['settlement']>['mode']
  }[]
}

function summarise(chat: Chat): Row {
  const docs: Row['docs'] = []
  let spent = 0
  let txSig: string | undefined
  let network: string | undefined
  const receipts: Row['receipts'] = []

  for (const m of chat.messages) {
    for (const c of m.citations ?? []) {
      docs.push({ handle: c.handle, shelf: c.shelf, price: c.price })
    }
    if (m.settlement) {
      spent += m.settlement.total
      txSig = m.settlement.txSig ?? txSig
      network = m.settlement.network ?? network
      if (m.settlement.invoice) {
        receipts.push({
          invoice: m.settlement.invoice,
          txSigs: m.settlement.txSigs?.length
            ? m.settlement.txSigs
            : m.settlement.txSig
              ? [m.settlement.txSig]
              : [],
          network: m.settlement.network,
          partial: m.settlement.partial,
          mode: m.settlement.mode,
        })
      }
    }
  }
  return { chat, docs, spent, txSig, network, receipts }
}

/**
 * The tab/route-shared body. Rendered full-page at /archive, and again as
 * the "내 질문" tab inside Memory — same component, same state, same t()
 * strings, just a different wrapper around it.
 */
export function ArchivePanel() {
  const { chats } = useUi()
  const t = useT()
  const [q, setQ] = useState('')
  const [paidOnly, setPaidOnly] = useState(false)

  const rows = useMemo(() => {
    const all = chats.map(summarise)
    const needle = q.trim().toLowerCase()
    return all
      .filter((r) => (paidOnly ? r.docs.length > 0 : true))
      .filter((r) =>
        needle
          ? r.chat.title.toLowerCase().includes(needle) ||
            r.docs.some(
              (d) =>
                d.shelf.toLowerCase().includes(needle) ||
                d.handle.toLowerCase().includes(needle),
            )
          : true,
      )
      .sort((a, b) => b.chat.createdAt - a.chat.createdAt)
  }, [chats, q, paidOnly])

  const totals = useMemo(() => {
    const all = chats.map(summarise)
    return {
      spent: all.reduce((s, r) => s + r.spent, 0),
      docs: all.reduce((s, r) => s + r.docs.length, 0),
    }
  }, [chats])

  return (
    <div className="mt-8 space-y-7">
      <div className="grid gap-5 border-b border-border/70 pb-7 lg:grid-cols-[1fr_auto] lg:items-end">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[1.3px] text-muted-foreground">
            {t('Question history')}
          </p>
          <h1 className="mt-2 text-[28px] font-semibold tracking-[-0.035em]">
            {t('My questions')}
          </h1>
          <p className="mt-3 max-w-2xl text-[15px] leading-7 text-muted-foreground">
            {t('Return to any question. When evidence was purchased, its exact invoice and Solana proof remain attached to the same row.')}
          </p>
        </div>
        <dl className="grid grid-cols-3 gap-7 text-right">
          <ArchiveTotal label={t('Questions')} value={chats.length.toString()} />
          <ArchiveTotal label={t('Paid documents')} value={totals.docs.toString()} />
          <ArchiveTotal label={t('Total spent')} value={`${formatUsdcFromKrw(totals.spent)} USDC`} />
        </dl>
      </div>

      {/* controls ----------------------------------------------------- */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('Search questions and shelves')}
            className="h-9 w-full rounded-[2px] border border-border bg-transparent pl-9 pr-3 text-sm outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-foreground/40"
          />
        </div>
        <Chip active={paidOnly} onClick={() => setPaidOnly((v) => !v)}>
          {t('Receipts only')}
        </Chip>
        <span className="ml-auto font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">
          {rows.length}{rows.length === 1 ? t(' question') : t(' questions')}
        </span>
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-[18vh] text-center">
          <h2 className="font-sans text-lg font-medium">
            {chats.length === 0
              ? t('Nothing asked yet')
              : t('No question matches')}
          </h2>
          <p className="max-w-[340px] text-sm leading-relaxed text-muted-foreground">
            {chats.length === 0
              ? t('Ask something and it lands here with whatever it opened, so you can come back to the passages you paid for.')
              : t('Try a different word, or turn off the opens filter.')}
          </p>
          {chats.length === 0 ? (
            <Button asChild variant="mono" size="mono" className="mt-2">
              <Link to="/">{t('Ask something')}</Link>
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="border-y border-border/70">
          {rows.map((r) => (
            <ThreadCard key={r.chat.id} row={r} />
          ))}
        </div>
      )}
    </div>
  )
}

/** /archive still resolves on its own — same panel, full-page wrapper. */
export default function Archive() {
  return (
    <div className="page-enter flex-1 overflow-y-auto">
      <div className="p-4 sm:p-6">
        <ArchivePanel />
      </div>
    </div>
  )
}

function ThreadCard({ row }: { row: Row }) {
  const { chat, docs, spent, txSig, network, receipts } = row
  const t = useT()
  const [open, setOpen] = useState(false)

  return (
    <article className="border-b border-border/70 last:border-b-0">
      <div className="grid gap-4 px-1 py-5 md:grid-cols-[120px_minmax(0,1fr)_auto] md:items-center md:gap-6">
        <div className="font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">
          <p>{relative(chat.createdAt, t)}</p>
          <p className="mt-1">{chat.messages.length}{t(' messages')}</p>
        </div>

        <div className="min-w-0">
          <p className="text-[15px] font-medium leading-6">{chat.title}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {docs.length
              ? `${docs.length}${t(' opened')} · ${formatUsdcFromKrw(spent)} USDC · ${receipts.length ? t('On-chain receipt available') : t('Legacy payment record')}`
              : t('No evidence was purchased for this question.')}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 md:justify-end">
          {receipts.map((receipt) => (
            <SettlementInvoiceDialog
              key={receipt.invoice.invoiceHash}
              invoice={receipt.invoice}
              settled
              partial={receipt.partial}
              txSigs={receipt.txSigs}
              network={receipt.network}
              mode={receipt.mode}
            />
          ))}
          {docs.length ? (
            <Button
              type="button"
              variant="monoGhost"
              size="monoSm"
              onClick={() => setOpen((value) => !value)}
            >
              {t('Evidence')}
              <ChevronDown className={`size-3 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
            </Button>
          ) : null}
          <Button asChild variant="monoGhost" size="monoSm">
            <Link to={`/chat/${chat.id}`}>
              {t('Open')}
              <ArrowUpRight className="size-3.5" />
            </Link>
          </Button>
        </div>
      </div>

      {docs.length && open ? (
            <div className="mb-4 border-l border-border/70 bg-muted/[0.28] md:ml-[calc(120px+1.5rem)] md:mr-1">
              {docs.map((d, i) => (
                <div
                  key={`${d.handle}-${i}`}
                  className="flex items-baseline gap-3 border-b border-border/60 px-4 py-3 last:border-0"
                >
                  <span className="font-mono text-[11px] uppercase tracking-[1px] text-muted-foreground">
                    {d.handle}
                  </span>
                  <Badge className="truncate px-1.5 py-0 uppercase tracking-[1px]">
                    {d.shelf}
                  </Badge>
                  <span className="ml-auto font-mono text-xs tabular-nums">
                    {formatUsdcFromKrw(d.price)} USDC
                  </span>
                </div>
              ))}
              {txSig ? (
                <div className="flex flex-wrap items-center gap-2 border-t border-border/60 px-4 py-3">
                  <span className="font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">
                    {t('Settled')}
                  </span>
                  <a
                    href={`https://explorer.solana.com/tx/${txSig}?cluster=${network ?? 'devnet'}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="truncate font-mono text-[11px] underline decoration-dotted underline-offset-4 hover:text-foreground"
                  >
                    {txSig.slice(0, 12)}…
                  </a>
                </div>
              ) : null}
            </div>
      ) : null}
    </article>
  )
}

function ArchiveTotal({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-mono text-[9px] uppercase tracking-[1px] text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-lg font-medium tabular-nums">{value}</dd>
    </div>
  )
}

/** Not a component, so the translator arrives as an argument, not a hook. */
function relative(ts: number, t: (en: string) => string) {
  const min = Math.round((Date.now() - ts) / 60000)
  if (min < 60) return `${Math.max(1, min)}${t('m ago')}`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}${t('h ago')}`
  return `${Math.round(hr / 24)}${t('d ago')}`
}
