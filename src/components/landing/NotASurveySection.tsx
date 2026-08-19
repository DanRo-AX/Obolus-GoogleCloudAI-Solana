import { useT } from '@/i18n'

/**
 * The survey comparison, because that is the category people will file this
 * under whether we like it or not — better to name it and say what is different.
 *
 * A table is the right shape here: the claim is a row-by-row swap, and a table
 * is the only layout that lets you read one row across without losing your place.
 */

const ROWS: { axis: string; old: string; ours: string }[] = [
  {
    axis: 'The unit',
    old: 'A form with forty questions',
    ours: 'One question, asked once, case by case',
  },
  {
    axis: 'Who is asked',
    old: 'A recruited panel, paid to sit there',
    ours: 'Whoever has actually lived it',
  },
  {
    axis: 'What you get paid',
    old: 'Points, a coupon, a prize draw',
    ours: 'USDC in your wallet, per answer',
  },
  {
    axis: 'After you answer',
    old: 'It disappears into somebody’s report',
    ours: 'It stays yours and keeps earning',
  },
  {
    axis: 'Who reads it',
    old: 'The company that ordered it, once',
    ours: 'Anyone whose question it fits',
  },
  {
    axis: 'What the asker gets',
    old: 'Three hundred people flattened into an average',
    ours: 'Four passages, each with an author',
  },
]

export function NotASurveySection() {
  const t = useT()
  return (
    <section className="border-t border-border bg-muted-2/40 px-4 py-20 sm:px-8 sm:py-28">
      <div className="mx-auto max-w-[92rem]">
        <h2 className="max-w-3xl text-balance font-display text-[32px] leading-[1.1] sm:text-[44px]">
          {t('A survey panel does the opposite of this, line by line.')}
        </h2>

        <p className="mt-6 max-w-2xl text-pretty text-[15px] leading-7 text-muted-foreground">
          {t(
            'People will file this under “survey” no matter what, so here it is next to one — the same rows, answered the other way.',
          )}
        </p>

        <div className="mt-12 overflow-x-auto">
          <table className="w-full min-w-[46rem] border-collapse text-left">
            <thead>
              <tr className="border-b border-border">
                <th className="w-[9rem] py-3 pr-6 font-mono text-[10px] font-normal uppercase tracking-[1.5px] text-muted-foreground" />
                <th className="py-3 pr-8 font-mono text-[10px] font-normal uppercase tracking-[1.5px] text-muted-foreground">
                  {t('A survey panel')}
                </th>
                <th className="py-3 font-mono text-[10px] font-normal uppercase tracking-[1.5px] text-foreground">
                  Obolus
                </th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((r) => (
                <tr key={r.axis} className="border-b border-border/60">
                  <td className="py-4 pr-6 align-top font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">
                    {t(r.axis)}
                  </td>
                  <td className="py-4 pr-8 align-top text-[15px] leading-relaxed text-muted-foreground">
                    {t(r.old)}
                  </td>
                  <td className="py-4 align-top text-[15px] leading-relaxed">
                    {t(r.ours)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}
