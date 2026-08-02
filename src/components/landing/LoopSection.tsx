import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Coins, MessageSquare, Notebook, Search, Split } from 'lucide-react'
import { GlitterWrap } from '@/components/GlitterWrap'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * What is actually being offered, said plainly and early. Three moves, in the
 * order a person meets them:
 *
 *   1. you ask, and it sweeps documents — whoever gets referenced gets paid
 *   2. if the answer is not there, the survey is cut case by case
 *   3. what you answered stays yours, and pays every time it is swept
 *
 * The third is the one that closes the loop back onto the first, which is why
 * the card carries the return arrow.
 */

type Step = {
  id: string
  n: string
  Icon: typeof Search
  eyebrow: string
  title: string
  body: string
  detail: string
  accent: string
}

const STEPS: Step[] = [
  {
    id: 'sweep',
    n: '01',
    Icon: Search,
    eyebrow: 'You ask',
    title: 'A question sweeps the documents, not the web',
    body: 'SHELF-1 reads what people wrote about living it, opens the closest few, and quotes them.',
    detail: 'Whoever gets referenced is paid for that open. Most demo documents cost ₩5–₩25.',
    accent: '#866FF2',
  },
  {
    id: 'cut',
    n: '02',
    Icon: Split,
    eyebrow: 'When it is not there',
    title: 'The survey gets cut case by case',
    body: 'Not a form. One question, priced on its own, posted to people who fit it.',
    detail: 'They answer that one question and take that one payment. Nothing bundled.',
    accent: '#0F766E',
  },
  {
    id: 'keep',
    n: '03',
    Icon: Notebook,
    eyebrow: 'And then it is yours',
    title: 'What you answered keeps earning',
    body: 'Every answer joins your memory and stays searchable under an anonymous handle.',
    detail: 'The next time someone sweeps and yours is referenced, you are paid again — without answering anything.',
    accent: '#866FF2',
  },
]

export function LoopSection() {
  const [hot, setHot] = useState<string | null>(null)

  return (
    <section className="px-4 sm:px-6">
      <div className="w-full">
        <div className="relative overflow-hidden rounded-lg border">
          <div className="absolute inset-0">
            <GlitterWrap
              style={{ backgroundColor: '#08070F' }}
              particleCount={160}
              speed={1.6}
              glitterIntensity={2}
              trailAmount={14}
            />
          </div>

          <div className="relative px-6 py-14 sm:px-10 sm:py-20">
            <div className="max-w-2xl">
              <span className="font-mono text-[10px] uppercase tracking-[2px] text-white/50">
                What this actually is
              </span>
              <h2 className="mt-4 font-display text-[27px] font-semibold leading-[1.22] text-white sm:text-[36px]">
                Ask, and the people you read get paid. Answer, and you become
                one of them.
              </h2>
              <p className="mt-4 max-w-xl text-[16px] leading-8 text-white/70">
                It is one loop, and both ends are the same people. Money moves
                every time a document is opened — never for the ones that stay
                closed.
              </p>
            </div>

            <ol className="mt-12 grid gap-3 lg:grid-cols-3">
              {STEPS.map((s) => (
                <li
                  key={s.id}
                  onMouseEnter={() => setHot(s.id)}
                  onMouseLeave={() => setHot(null)}
                  className={cn(
                    'flex flex-col rounded-md border border-white/12 bg-white/[0.06] p-5 backdrop-blur-md transition-colors duration-300',
                    hot === s.id && 'border-white/25 bg-white/[0.1]',
                  )}
                >
                  <div className="flex items-center gap-3">
                    <span
                      className="flex size-8 shrink-0 items-center justify-center rounded-[4px]"
                      style={{ backgroundColor: `${s.accent}2e` }}
                    >
                      <s.Icon className="size-4" style={{ color: s.accent }} />
                    </span>
                    <span className="font-mono text-[10px] uppercase tracking-[1.5px] text-white/45">
                      {s.n} · {s.eyebrow}
                    </span>
                  </div>

                  <h3 className="mt-4 font-sans text-[17px] font-medium leading-snug text-white">
                    {s.title}
                  </h3>
                  <p className="mt-2 text-[14px] leading-relaxed text-white/65">
                    {s.body}
                  </p>

                  <p
                    className="mt-4 flex gap-2.5 border-t border-white/10 pt-4 text-[13px] leading-relaxed text-white/80"
                    style={{ borderTopColor: hot === s.id ? `${s.accent}55` : undefined }}
                  >
                    <Coins
                      className="mt-0.5 size-3.5 shrink-0"
                      style={{ color: s.accent }}
                    />
                    {s.detail}
                  </p>
                </li>
              ))}
            </ol>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button
                asChild
                variant="mono"
                size="mono"
                className="bg-white text-[#08070F] hover:bg-white/90"
              >
                <Link to="/dashboard">
                  <MessageSquare className="size-3.5" />
                  See what is being asked
                </Link>
              </Button>
              <span className="font-mono text-[10px] uppercase tracking-[1px] text-white/40">
                open calls are live now
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
