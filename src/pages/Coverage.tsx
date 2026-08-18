import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight, Database, GitBranch, ShieldCheck } from 'lucide-react'
import { CategoryIcon } from '@/components/CategoryIcon'
import { Button } from '@/components/ui/button'
import { CATEGORIES } from '@/data/categories'
import { useT } from '@/i18n'
import { useUi } from '@/state/ui'

const RANKING = [
  {
    Icon: Database,
    title: 'Free discovery',
    body: 'Seeing which questions have no answer costs nothing. You get an anonymous handle and the price — the answer itself only shows once you open one and pay.',
  },
  {
    Icon: GitBranch,
    title: 'Query-specific authority',
    body: 'Once answers pile up, each question ranks whose answer fits it best — judged for that one question, not the whole field.',
  },
  {
    Icon: ShieldCheck,
    title: 'Paid boundary',
    body: 'The price is fixed before you open. The answer unlocks only after payment clears — nothing moves before that.',
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
            <h1 className="font-sans text-base font-medium">{t('Questions still waiting for an answer')}</h1>
            <Button asChild variant="mono" size="mono">
              <Link to="/">{t('Ask')}</Link>
            </Button>
          </div>

          <p className="mt-4 max-w-2xl text-[15px] leading-7 text-muted-foreground">
            {t('Someone asked these, and no answer fits yet. The asker already set what one answer is worth, and people who would know are being found. You cannot read the answers here — opening one is what does that.')}
          </p>

          {/* Three floating cards. Lifted off the page with a gap between them so
              each reads as its own card; a softened dark (not near-black) keeps
              them elevated without going heavy. */}
          <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {RANKING.map(({ Icon, title, body }) => (
              <article
                key={title}
                className="rounded-xl bg-[#34343a] p-5 text-primary-foreground shadow-[0_8px_24px_-8px_rgba(20,20,25,0.3)]"
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
                {t('Each row is one field with questions still open. Reading across: how many questions are open, how many answers they will still take, the most anyone pays for one answer, and the money still on the table.')}
              </p>
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-1 font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">
              <span><strong className="text-foreground">{totals.calls}</strong> {t('Open questions')}</span>
              <span><strong className="text-foreground">{totals.remaining}</strong> {t('Answers wanted')}</span>
              <span><strong className="text-foreground">₩{totals.budget.toLocaleString()}</strong> {t('On the table')}</span>
            </div>
          </div>

          {/* Column headers ride above as a light label row; each field is then
              its own white card — a hairline border and a soft, slightly-dark
              shadow give it depth, with tighter corners than the cards above. */}
          <div className="mt-6">
            <div className="grid grid-cols-[1fr_auto] gap-3 px-4 pb-2.5 font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground sm:grid-cols-[1fr_repeat(4,110px)]">
              <span>{t('Area')}</span>
              <span className="hidden text-right sm:block">{t('Open questions')}</span>
              <span className="hidden text-right sm:block">{t('Answers wanted')}</span>
              <span className="hidden text-right sm:block">{t('Top per answer')}</span>
              <span className="text-right">{t('On the table')}</span>
            </div>
            <div className="flex flex-col gap-2">
              {rows.map((row) => (
                <Link
                  key={row.id}
                  to={`/dashboard?category=${row.id}`}
                  className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-md border border-border/70 bg-background px-4 py-3.5 text-sm text-foreground shadow-[0_1px_2px_rgba(20,20,25,0.06),0_2px_6px_-2px_rgba(20,20,25,0.12)] transition-all hover:-translate-y-0.5 hover:border-border hover:shadow-[0_4px_14px_-2px_rgba(20,20,25,0.16)] sm:grid-cols-[1fr_repeat(4,110px)]"
                >
                  <span className="flex items-center gap-2 font-medium">
                    <CategoryIcon
                      id={row.id}
                      className="size-3.5 shrink-0"
                      style={{ color: row.accent }}
                    />
                    {t(row.label)}
                    <ArrowUpRight className="size-3 text-muted-foreground" />
                  </span>
                  <span className="hidden text-right font-mono text-xs tabular-nums text-muted-foreground sm:block">{row.calls}</span>
                  <span className="hidden text-right font-mono text-xs tabular-nums text-muted-foreground sm:block">{row.remaining}</span>
                  <span className="hidden text-right font-mono text-xs tabular-nums text-muted-foreground sm:block">{row.topRate ? `₩${row.topRate.toLocaleString()}` : '—'}</span>
                  <span className="text-right font-mono text-xs tabular-nums text-foreground">{row.budget ? `₩${row.budget.toLocaleString()}` : '—'}</span>
                </Link>
              ))}
            </div>
          </div>

          {/* Bottom note — a clean white card with a lead icon rather than a flat
              gray box, consistent with the field rows above. */}
          <div className="mt-6 flex max-w-2xl items-start gap-3 rounded-md border border-border/70 bg-background p-5 shadow-[0_1px_2px_rgba(20,20,25,0.06),0_2px_6px_-2px_rgba(20,20,25,0.1)]">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <p className="text-sm leading-relaxed text-muted-foreground">
              <span className="font-medium text-foreground">{t('These numbers are exactly what is here.')}</span>{' '}
              {t('Every figure comes from questions that are really open. A stand-in answer a model wrote does not count — it fills no slot and earns nothing. An empty row means nobody has answered yet, for real.')}
            </p>
          </div>
        </section>
      </div>
    </div>
  )
}
