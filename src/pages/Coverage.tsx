import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight, Database, GitBranch, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CATEGORIES } from '@/data/categories'
import { useUi } from '@/state/ui'

const RANKING = [
  {
    Icon: Database,
    title: 'Free discovery',
    body: 'The index exposes handles, prices, category, optional demographic bands, hashes, and score components—not private passage text.',
  },
  {
    Icon: GitBranch,
    title: 'Query-specific authority',
    body: 'Rust combines lexical and hash relevance, freshness, trust, and personalized PageRank over independently verified evidence edges.',
  },
  {
    Icon: ShieldCheck,
    title: 'Paid boundary',
    body: 'The selected content hash, owner, amount, mint, and network are committed before payment. Only a matching paid callback releases the snapshot.',
  },
] as const

export default function Coverage() {
  const { orders } = useUi()
  const rows = useMemo(() => {
    return CATEGORIES.map((category) => {
      const calls = orders.filter(
        (order) => order.category === category.id && order.answered < order.target,
      )
      const remaining = calls.reduce(
        (total, order) => total + Math.max(0, order.target - order.answered),
        0,
      )
      const budget = calls.reduce(
        (total, order) =>
          total + Math.max(0, order.target - order.answered) * order.unitPrice,
        0,
      )
      const topRate = calls.reduce((top, order) => Math.max(top, order.unitPrice), 0)
      return { ...category, calls: calls.length, remaining, budget, topRate }
    }).sort((a, b) => b.budget - a.budget)
  }, [orders])

  const totals = rows.reduce(
    (sum, row) => ({
      calls: sum.calls + row.calls,
      remaining: sum.remaining + row.remaining,
      budget: sum.budget + row.budget,
    }),
    { calls: 0, remaining: 0, budget: 0 },
  )

  return (
    <div className="page-enter flex-1 overflow-y-auto">
      <div className="space-y-8 p-4 sm:p-6">
        <section>
          <div className="flex min-h-8 flex-wrap items-center justify-between gap-4">
            <h1 className="font-sans text-base font-medium">Thin shelves</h1>
            <Button asChild variant="mono" size="mono">
              <Link to="/">Ask</Link>
            </Button>
          </div>

          <p className="mt-4 max-w-2xl text-[15px] leading-7 text-muted-foreground">
            Under 300 documents a shelf cannot answer reliably. You cannot
            browse the documents themselves — that is what opening one is for.
            What you can see is where a question comes back empty, and what
            someone has already offered to fill it.
          </p>

          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            {RANKING.map(({ Icon, title, body }) => (
              <article key={title} className="rounded-[6px] border border-border bg-card p-5">
                <Icon className="size-4 text-muted-foreground" />
                <h2 className="mt-4 text-sm font-medium">{title}</h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{body}</p>
              </article>
            ))}
          </div>
        </section>

        <section>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="font-sans text-lg font-medium">
                Asked, and nothing answered
              </h2>
              <p className="mt-2 max-w-2xl text-[15px] leading-7 text-muted-foreground">
                Nothing on the shelves has answered these yet. Every open call
                here is live from the server: it goes to people who would know,
                and the asker has already named what one answer is worth.
              </p>
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-1 font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">
              <span><strong className="text-foreground">{totals.calls}</strong> open calls</span>
              <span><strong className="text-foreground">{totals.remaining}</strong> slots left</span>
              <span><strong className="text-foreground">₩{totals.budget.toLocaleString()}</strong> waiting</span>
            </div>
          </div>

          <div className="mt-6 overflow-hidden rounded-[6px] border border-border bg-card">
            <div className="grid grid-cols-[1fr_auto] gap-3 border-b border-border bg-muted-2 px-4 py-2.5 font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground sm:grid-cols-[1fr_repeat(4,110px)]">
              <span>Area</span>
              <span className="hidden text-right sm:block">Open calls</span>
              <span className="hidden text-right sm:block">Slots left</span>
              <span className="hidden text-right sm:block">Top per answer</span>
              <span className="text-right">Budget left</span>
            </div>
            {rows.map((row) => (
              <Link
                key={row.id}
                to={`/dashboard?category=${row.id}`}
                className="grid grid-cols-[1fr_auto] items-center gap-3 border-b border-border/70 px-4 py-3 text-sm transition-colors last:border-0 hover:bg-foreground/[0.025] sm:grid-cols-[1fr_repeat(4,110px)]"
              >
                <span className="flex items-center gap-2 font-medium">
                  <span className="size-2 rounded-[1px]" style={{ backgroundColor: row.accent }} />
                  {row.label}
                  <ArrowUpRight className="size-3 text-muted-foreground" />
                </span>
                <span className="hidden text-right font-mono text-xs tabular-nums text-muted-foreground sm:block">{row.calls}</span>
                <span className="hidden text-right font-mono text-xs tabular-nums text-muted-foreground sm:block">{row.remaining}</span>
                <span className="hidden text-right font-mono text-xs tabular-nums text-muted-foreground sm:block">{row.topRate ? `₩${row.topRate.toLocaleString()}` : '—'}</span>
                <span className="text-right font-mono text-xs tabular-nums">{row.budget ? `₩${row.budget.toLocaleString()}` : '—'}</span>
              </Link>
            ))}
          </div>

          <p className="mt-6 max-w-2xl rounded-[6px] border border-border bg-foreground/[0.03] p-5 text-sm leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground">
              This page is the honest version of the hardest problem.
            </span>{' '}
            An empty shelf leaves SHELF-1 nothing to open. Every number here
            comes from the authenticated open-call state — a baseline answer
            written by a model never appears in it, never fills a slot, and is
            never paid for.
          </p>
        </section>
      </div>
    </div>
  )
}
