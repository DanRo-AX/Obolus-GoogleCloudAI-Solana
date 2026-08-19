import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight } from 'lucide-react'
import { CATEGORIES } from '@/data/categories'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import { useUi } from '@/state/ui'

/**
 * The recruitment argument, made with the live board instead of a claim.
 *
 * "Answer questions and get paid" is abstract until you see that there are four
 * calls open in the thing you happen to do and what they pay. Every tile links
 * straight into that field on the dashboard.
 */
export function FieldsSection() {
  const { orders } = useUi()
  const t = useT()

  const rows = useMemo(() => {
    const open = orders.filter((o) => !o.mine && o.answered < o.target)
    return CATEGORIES.map((c) => {
      const mine = open.filter((o) => o.category === c.id)
      const pot = mine.reduce(
        (s, o) => s + o.unitPrice * (o.target - o.answered),
        0,
      )
      const top = mine.reduce((m, o) => Math.max(m, o.unitPrice), 0)
      return { ...c, count: mine.length, pot, top }
    }).sort((a, b) => b.pot - a.pot)
  }, [orders])

  const totalPot = rows.reduce((s, r) => s + r.pot, 0)
  const totalOpen = rows.reduce((s, r) => s + r.count, 0)

  return (
    <div className="px-4 sm:px-6">
      <h2 className="max-w-4xl text-balance font-display text-[32px] leading-[1.05] tracking-[-0.01em] font-medium sm:text-[52px]">
        {t('Somebody is already paying for what you know')}
      </h2>
      <p className="mt-5 max-w-xl text-pretty text-[17px] leading-8 text-muted-foreground">
        {t('Open calls right now, by field. Pick one you have lived.')}
      </p>

      <div className="mt-8 flex flex-wrap items-center gap-x-8 gap-y-2 font-mono text-[11px] uppercase tracking-[1px] text-muted-foreground">
        <span>
          <span className="tabular-nums text-foreground">{totalOpen}</span>
          {t(' open calls')}
        </span>
        <span>
          <span className="tabular-nums text-foreground">
            ₩{totalPot.toLocaleString()}
          </span>
          {t(' unclaimed across all fields')}
        </span>
      </div>

      <div className="mt-10 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((r) => (
          <Link
            key={r.id}
            to={`/dashboard?category=${r.id}`}
            className={cn(
              'group flex items-center gap-3 rounded-[5px] border border-border p-4 transition-all',
              r.count
                ? 'hover:-translate-y-0.5 hover:border-foreground/25 hover:shadow-sm'
                : 'opacity-45',
            )}
          >
            <span
              className="flex size-9 shrink-0 items-center justify-center rounded-[4px]"
              style={{ backgroundColor: `${r.accent}1f` }}
            >
              <r.Icon className="size-4" style={{ color: r.accent }} />
            </span>

            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 text-[15px] font-medium">
                {t(r.label)}
                <ArrowUpRight className="size-3.5 opacity-0 transition-opacity group-hover:opacity-60" />
              </span>
              <span className="mt-0.5 block font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">
                {r.count ? (
                  <>
                    {r.count}
                    {t(' calls · up to ')}₩{r.top.toLocaleString()}
                    {t(' each')}
                  </>
                ) : (
                  t('No calls open yet')
                )}
              </span>
            </span>

            <span className="shrink-0 text-right font-mono text-xs tabular-nums">
              {r.pot ? (
                <span className="text-foreground">
                  ₩{r.pot.toLocaleString()}
                </span>
              ) : (
                <span className="text-muted-foreground/50">—</span>
              )}
            </span>
          </Link>
        ))}
      </div>

      <p className="mt-8 font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">
        {t('Amounts are what is still unclaimed on each call')}
      </p>
    </div>
  )
}
