import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Database } from 'lucide-react'
import { CategoryIcon } from '@/components/CategoryIcon'
import { Button } from '@/components/ui/button'
import { AnimatedFeatureSpotlight } from '@/components/ui/feature-spotlight'
import { GlassDemandCard } from '@/components/ui/glass-blog-card-shadcnui'
import coverageHeroWordmark from '@/assets/product/coverage-hero-wordmark.png'
import { CATEGORIES } from '@/data/categories'
import { useT } from '@/i18n'
import { formatUsdcFromKrw } from '@/lib/usdc'
import { useUi } from '@/state/ui'

export default function Coverage() {
  const t = useT()
  const { orders } = useUi()
  const rows = useMemo(() => {
    return CATEGORIES.map((category) => {
      const categoryOrders = orders.filter((order) => order.category === category.id)
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
      const answered = categoryOrders.reduce((total, order) => total + order.answered, 0)
      const contributorHandles = Array.from(
        new Set(categoryOrders.flatMap((order) => order.contributorHandles ?? [])),
      ).slice(0, 4)
      return {
        ...category,
        calls: calls.length,
        remaining,
        budget,
        topRate,
        answered,
        contributorHandles,
      }
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
      <div className="w-full">
        <AnimatedFeatureSpotlight
          className="rounded-none border-x-0 border-t-0"
          compact
          preheaderIcon={<Database className="size-3.5" />}
          preheaderText={t('Live demand for human evidence')}
          heading={t('See where human answers are needed — and what each answer is worth.')}
          description={t('Obulus searches existing human evidence before anyone pays. When the right answer is missing, the buyer sets the number of people and reward per answer. The figures below show what is still needed now.')}
          action={(
            <Button
              asChild
              size="monoLg"
              className="bg-white text-black hover:bg-white/85"
            >
              <Link to="/">{t('Ask a question')}</Link>
            </Button>
          )}
          visual={(
            <img
              src={coverageHeroWordmark}
              alt="OBOLUS"
              className="h-full max-h-[235px] w-full object-cover object-center"
            />
          )}
        />

        <section className="p-4 sm:p-6 lg:p-8">
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
              <span><strong className="text-foreground">{formatUsdcFromKrw(totals.budget)} USDC</strong> {t('On the table')}</span>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {rows.map((row, index) => (
              <Link
                key={row.id}
                to={`/dashboard?category=${row.id}`}
                aria-label={`${t(row.label)} · ${t('On the table')} ${row.budget ? `${formatUsdcFromKrw(row.budget)} USDC` : '—'}`}
                className="block h-full rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2"
              >
                <GlassDemandCard
                  title={t(row.label)}
                  excerpt={t(row.blurb)}
                  icon={<CategoryIcon id={row.id} className="size-9 stroke-[1.5]" />}
                  seed={`coverage:${row.id}`}
                  coverFilter={`hue-rotate(${index * 9}deg) saturate(${row.calls ? 1.06 : 0.82}) brightness(${row.calls ? 1.08 : 0.9})`}
                  active={row.calls > 0}
                  status={row.calls ? `${row.calls} ${t('Open questions')}` : t('No open calls yet')}
                  amount={row.budget ? `${formatUsdcFromKrw(row.budget)} USDC` : '—'}
                  actionLabel={t('View field')}
                  contributorHandles={row.contributorHandles}
                  contributorLabel={t('recorded contributors')}
                  emptyContributorLabel={t('No recorded contributors yet')}
                  answerCount={row.answered}
                  answerCountLabel={t('answers recorded')}
                />
              </Link>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
