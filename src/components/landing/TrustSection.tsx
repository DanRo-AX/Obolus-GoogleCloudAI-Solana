import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n'

/**
 * The terms, stated as plainly as they will ever be stated.
 *
 * This is the last thing before the FAQ because it is the last objection: a
 * person is being asked to write down their life. The layout is deliberately
 * flat — no cards, no icons — so it reads as terms rather than as marketing.
 */

const GIVE = [
  'What your day actually costs, and where it goes.',
  'The fields you have lived — work, family, health.',
  'A wallet address, so money has somewhere to land.',
]

const NEVER = [
  'Your name, face, or email — an asker sees a handle.',
  'Bank details, card numbers, or national ID.',
  'Your seed phrase or authority over the rest of your wallet.',
]

export function TrustSection() {
  const t = useT()
  return (
    <section className="border-t border-border px-4 py-28 sm:px-8 sm:py-40">
      <div className="mx-auto max-w-[92rem]">
        <p className="font-mono text-[10px] uppercase tracking-[1.5px] text-muted-foreground">
          {t('The deal, in full')}
        </p>

        <h2 className="mt-5 max-w-4xl text-balance font-display text-[32px] leading-[1.05] tracking-[-0.01em] sm:text-[54px]">
          {t(
            'You are writing down your life. Here is exactly what happens to it.',
          )}
        </h2>

        <div className="mt-16 grid grid-cols-1 gap-12 sm:mt-24 lg:grid-cols-2 lg:gap-20">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[1.5px] text-foreground">
              {t('What you hand over')}
            </p>
            <ul className="mt-5 flex flex-col">
              {GIVE.map((g) => (
                <li
                  key={g}
                  className="border-t border-border py-4 text-[15px] leading-relaxed"
                >
                  {t(g)}
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="font-mono text-[10px] uppercase tracking-[1.5px] text-muted-foreground">
              {t('What we never take')}
            </p>
            <ul className="mt-5 flex flex-col">
              {NEVER.map((n) => (
                <li
                  key={n}
                  className="border-t border-border py-4 text-[15px] leading-relaxed text-muted-foreground"
                >
                  {t(n)}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-14 flex flex-wrap items-center gap-x-10 gap-y-4 border-t border-border pt-8">
          <p className="max-w-xl text-pretty text-[15px] leading-7">
            <span className="font-medium">
              {t('Delete your shelf and it burns.')}
            </span>{' '}
            <span className="text-muted-foreground">
              {t(
                'Every document you wrote drops out of search immediately and is destroyed. We keep nothing for analytics.',
              )}
            </span>
          </p>
          <Button asChild variant="mono" size="monoLg" className="ml-auto">
            <Link to="/onboarding">
              {t('Start writing')}
              <ArrowRight className="size-3.5" />
            </Link>
          </Button>
        </div>
      </div>
    </section>
  )
}
