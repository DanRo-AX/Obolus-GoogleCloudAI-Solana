import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight, Database, GitBranch, ShieldCheck } from 'lucide-react'
import { CategoryIcon } from '@/components/CategoryIcon'
import { Button } from '@/components/ui/button'
import { Banner } from '@/components/ui/primitives'
import { CATEGORIES } from '@/data/categories'
import { useT } from '@/i18n'
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
  const t = useT()
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
      <div className="mx-auto max-w-4xl space-y-8 p-4 sm:p-6">
        <section>
          <div className="flex min-h-8 flex-wrap items-center justify-between gap-4">
            <h1 className="font-sans text-base font-medium">{t('Thin shelves')}</h1>
            <Button asChild variant="mono" size="mono">
              <Link to="/">{t('Ask')}</Link>
            </Button>
          </div>

          <p className="mt-4 max-w-2xl text-[15px] leading-7 text-muted-foreground">
            {t(
              'Under 300 documents a shelf cannot answer reliably. You cannot browse the documents themselves — that is what opening one is for. What you can see is where a question comes back empty, and what someone has already offered to fill it.',
            )}
          </p>

          {/* Three floating soft-black cards, lifted off the page with a gap
              between them so each reads as its own card rather than a joined
              table cell. */}
          <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {RANKING.map(({ Icon, title, body }) => (
              <article
                key={title}
                className="rounded-xl bg-primary p-5 text-primary-foreground shadow-[0_8px_24px_-8px_rgba(20,20,25,0.35)]"
              >
                <Icon className="size-4 text-primary-foreground/60" />
                <h2 className="mt-4 text-sm font-medium">{t(title)}</h2>
                <p className="mt-2 text-sm leading-6 text-primary-foreground/65">{t(body)}</p>
              </article>
            ))}
          </div>
        </section>

        <section>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="font-sans text-lg font-medium">
                {t('Asked, and nothing answered')}
              </h2>
              <p className="mt-2 max-w-2xl text-[15px] leading-7 text-muted-foreground">
                {t(
                  'Nothing on the shelves has answered these yet. Every open call here is live from the server: it goes to people who would know, and the asker has already named what one answer is worth.',
                )}
              </p>
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-1 font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">
              <span><strong className="text-foreground">{totals.calls}</strong> {t('open calls')}</span>
              <span><strong className="text-foreground">{totals.remaining}</strong> {t('slots left')}</span>
              <span><strong className="text-foreground">₩{totals.budget.toLocaleString()}</strong> {t('waiting')}</span>
            </div>
          </div>

          {/* Column headers ride above as a light label row; each category is
              then its own floating soft-black card, lifted with a shadow and
              separated by a gap instead of joined by hairlines. */}
          <div className="mt-6">
            <div className="grid grid-cols-[1fr_auto] gap-3 px-4 pb-2.5 font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground sm:grid-cols-[1fr_repeat(4,110px)]">
              <span>{t('Area')}</span>
              <span className="hidden text-right sm:block">{t('Open calls')}</span>
              <span className="hidden text-right sm:block">{t('Slots left')}</span>
              <span className="hidden text-right sm:block">{t('Top per answer')}</span>
              <span className="text-right">{t('Budget left')}</span>
            </div>
            <div className="flex flex-col gap-2">
              {rows.map((row) => (
                <Link
                  key={row.id}
                  to={`/dashboard?category=${row.id}`}
                  className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-xl bg-primary px-4 py-3.5 text-sm text-primary-foreground shadow-[0_6px_20px_-8px_rgba(20,20,25,0.3)] transition-all hover:-translate-y-0.5 hover:shadow-[0_10px_28px_-8px_rgba(20,20,25,0.42)] sm:grid-cols-[1fr_repeat(4,110px)]"
                >
                  <span className="flex items-center gap-2 font-medium">
                    <CategoryIcon
                      id={row.id}
                      className="size-3.5 shrink-0"
                      style={{ color: row.accent }}
                    />
                    {t(row.label)}
                    <ArrowUpRight className="size-3 text-primary-foreground/60" />
                  </span>
                  <span className="hidden text-right font-mono text-xs tabular-nums text-primary-foreground/65 sm:block">{row.calls}</span>
                  <span className="hidden text-right font-mono text-xs tabular-nums text-primary-foreground/65 sm:block">{row.remaining}</span>
                  <span className="hidden text-right font-mono text-xs tabular-nums text-primary-foreground/65 sm:block">{row.topRate ? `₩${row.topRate.toLocaleString()}` : '—'}</span>
                  <span className="text-right font-mono text-xs tabular-nums text-primary-foreground">{row.budget ? `₩${row.budget.toLocaleString()}` : '—'}</span>
                </Link>
              ))}
            </div>
          </div>

          <Banner tone="neutral" className="mt-6 max-w-2xl p-5 text-sm leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground">
              {t('This page is the honest version of the hardest problem.')}
            </span>{' '}
            {t(
              'An empty shelf leaves SHELF nothing to open. Every number here comes from the authenticated open-call state — a baseline answer written by a model never appears in it, never fills a slot, and is never paid for.',
            )}
          </Banner>
        </section>
      </div>
    </div>
  )
}
