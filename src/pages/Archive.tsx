import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowUpRight,
  Coins,
  MessageSquare,
  Receipt,
  Search,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge, Chip } from '@/components/ui/primitives'
import { useT } from '@/i18n'
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
}

function summarise(chat: Chat): Row {
  const docs: Row['docs'] = []
  let spent = 0
  let txSig: string | undefined
  let network: string | undefined

  for (const m of chat.messages) {
    for (const c of m.citations ?? []) {
      docs.push({ handle: c.handle, shelf: c.shelf, price: c.price })
    }
    if (m.settlement) {
      spent += m.settlement.total
      txSig = m.settlement.txSig ?? txSig
      network = m.settlement.network ?? network
    }
  }
  return { chat, docs, spent, txSig, network }
}

export default function Archive() {
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
    <div className="page-enter flex-1 overflow-y-auto">
      <div className="space-y-6 p-4 sm:p-6">
        <div className="flex min-h-8 flex-wrap items-center justify-between gap-4">
          <h1 className="font-sans text-base font-medium">{t('Receipts')}</h1>
          <div className="flex items-center gap-5 font-mono text-xs uppercase tracking-[1px] text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <MessageSquare className="size-3.5" />
              <span className="tabular-nums text-foreground">
                {chats.length}
              </span>
              {t(' asked')}
            </span>
            <span className="flex items-center gap-1.5">
              <Receipt className="size-3.5" />
              <span className="tabular-nums text-foreground">
                {totals.docs}
              </span>
              {t(' opened')}
            </span>
            <span className="flex items-center gap-1.5">
              <Coins className="size-3.5" />
              <span className="tabular-nums text-foreground">
                ₩{totals.spent.toLocaleString()}
              </span>
              {t(' spent')}
            </span>
          </div>
        </div>

        <p className="max-w-2xl text-[15px] leading-7 text-muted-foreground">
          {t('Every question you have asked, and the passages it paid for. You pay for an open once — the document stays readable here after that.')}
        </p>

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
            {t('With opens')}
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
          <div className="flex flex-col gap-3">
            {rows.map((r) => (
              <ThreadCard key={r.chat.id} row={r} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function ThreadCard({ row }: { row: Row }) {
  const { chat, docs, spent, txSig, network } = row
  const t = useT()
  const [open, setOpen] = useState(false)

  return (
    <div className="rounded-[6px] border border-border bg-card">
      <div className="flex flex-wrap items-start gap-3 p-5">
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">
            {relative(chat.createdAt, t)} · {chat.messages.length}{t(' messages')}
          </p>
          <p className="mt-1.5 text-[15px] leading-relaxed">{chat.title}</p>
        </div>

        <div className="flex shrink-0 items-center gap-4">
          {docs.length ? (
            <span className="font-mono text-xs tabular-nums text-muted-foreground">
              {docs.length}{t(' opened')} ·{' '}
              <span className="text-foreground">
                ₩{spent.toLocaleString()}
              </span>
            </span>
          ) : (
            <span className="font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">
              {t('Nothing opened')}
            </span>
          )}
          <Button asChild variant="monoGhost" size="monoSm">
            <Link to={`/chat/${chat.id}`}>
              {t('Back to it')}
              <ArrowUpRight className="size-3.5" />
            </Link>
          </Button>
        </div>
      </div>

      {docs.length ? (
        <>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex w-full cursor-pointer items-center gap-2 border-t border-border px-5 py-2.5 font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground transition-colors hover:bg-foreground/[0.02] hover:text-foreground"
          >
            <Receipt className="size-3" />
            {open ? t('Hide receipt') : t('Show receipt')}
          </button>

          {open ? (
            <div className="border-t border-border">
              {docs.map((d, i) => (
                <div
                  key={`${d.handle}-${i}`}
                  className="flex items-baseline gap-3 border-b border-border/60 px-5 py-2.5 last:border-0"
                >
                  <span className="font-mono text-[11px] uppercase tracking-[1px] text-muted-foreground">
                    {d.handle}
                  </span>
                  <Badge className="truncate px-1.5 py-0 uppercase tracking-[1px]">
                    {d.shelf}
                  </Badge>
                  <span className="ml-auto font-mono text-xs tabular-nums">
                    ₩{d.price.toLocaleString()}
                  </span>
                </div>
              ))}
              {txSig ? (
                <div className="flex flex-wrap items-center gap-2 bg-muted-2/50 px-5 py-2.5">
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
        </>
      ) : null}
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
