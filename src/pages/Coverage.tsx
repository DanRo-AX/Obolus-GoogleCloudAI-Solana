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
      <div className="mx-auto max-w-[76rem] space-y-12 p-4 sm:p-6">
        <section>
          <span className="font-mono text-[10px] uppercase tracking-[1.5px] text-muted-foreground">
            Live human demand
          </span>
          <div className="mt-3 flex flex-wrap items-end justify-between gap-5">
            <div>
              <h1 className="font-display text-3xl font-medium">Coverage is decided per question</h1>
              <p className="mt-3 max-w-2xl text-[15px] leading-7 text-muted-foreground">
                OPENSHELF does not publish private shelf counts or passages as a
                browseable catalogue. A query applies its own filters, ranking,
                author diversity, requested count, and budget before deciding
                whether human coverage is sufficient.
              </p>
            </div>
            <Button asChild variant="mono" size="mono">
              <Link to="/">Test a question</Link>
            </Button>
          </div>

          <div className="mt-8 grid gap-4 sm:grid-cols-3">
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
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <span className="font-mono text-[10px] uppercase tracking-[1.5px] text-muted-foreground">
                Open calls from the server
              </span>
              <h2 className="mt-2 font-display text-2xl font-medium">Where new answers are needed now</h2>
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-1 font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">
              <span><strong className="text-foreground">{totals.calls}</strong> calls</span>
              <span><strong className="text-foreground">{totals.remaining}</strong> slots</span>
              <span><strong className="text-foreground">₩{totals.budget.toLocaleString()}</strong> remaining</span>
            </div>
          </div>

          <div className="mt-6 overflow-hidden rounded-[6px] border border-border bg-card">
            <div className="grid grid-cols-[1fr_auto] gap-3 border-b border-border bg-muted-2 px-4 py-2.5 font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground sm:grid-cols-[1fr_repeat(4,110px)]">
              <span>Field</span>
              <span className="hidden text-right sm:block">Open calls</span>
              <span className="hidden text-right sm:block">Slots left</span>
              <span className="hidden text-right sm:block">Top rate</span>
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
          <p className="mt-4 text-sm leading-6 text-muted-foreground">
            These totals come from the authenticated open-call state. AI baseline
            output never appears here, never fills a slot, and never becomes paid inventory.
          </p>
        </section>
      </div>
    </div>
  )
}
