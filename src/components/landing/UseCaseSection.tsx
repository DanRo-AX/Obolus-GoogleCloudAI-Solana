import { Fragment, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowUpRight, ChevronLeft, ChevronRight } from 'lucide-react'
import { SlotText } from '@/components/SlotText'
import { USE_CASES } from '@/data/useCases'
import { USE_CASE_THEME } from '@/data/sources'
import { cn } from '@/lib/utils'
import { useUi } from '@/state/ui'

/**
 * "From simple queries to frontier workloads in …" — picking a vertical swaps
 * the trending-tool chips, the canvas palette, and the three-prompt carousel.
 */
export function UseCaseSection() {
  const [cat, setCat] = useState(0)
  const [slide, setSlide] = useState(0)
  const navigate = useNavigate()
  const { createChat } = useUi()

  const useCase = USE_CASES[cat]
  const prompt = useCase.prompts[slide % useCase.prompts.length]
  const theme = USE_CASE_THEME[useCase.label] ?? {
    background: '#0a1420',
    color: '#54a2ff',
    colorAlt: '#8a959b',
  }

  const pick = (i: number) => {
    setCat(i)
    setSlide(0)
  }

  const trending = (
    <div>
      <p className="font-mono text-[10px] font-medium uppercase tracking-[1px] text-muted-foreground">
        Shelves matching now
      </p>
      <div
        key={useCase.label}
        className="animate-zoom-in-95 mt-3 flex flex-wrap gap-1.5"
      >
        {useCase.tools.map((t) => (
          <div
            key={t.name}
            className="inline-flex items-center gap-1.5 rounded-[3px] border border-transparent bg-foreground/[0.06] px-2.5 py-1 text-sm text-foreground transition-colors"
          >
            <span className="flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-[2px] bg-foreground/10 font-mono text-[10px] font-semibold">
              {t.name.slice(0, 2)}
            </span>
            {t.name}
          </div>
        ))}
      </div>
    </div>
  )

  return (
    <section className="px-4 sm:px-6">
      <div className="w-full">
        <div className="grid items-center gap-10 lg:grid-cols-[2fr_3fr] lg:gap-16">
          <div className="max-w-md">
            <h2 className="font-sans text-xl font-medium leading-[1.5] sm:text-2xl sm:leading-[1.5]">
              <span className="text-foreground">
                From a quick lookup to real fieldwork, in{' '}
              </span>
              {USE_CASES.map((u, i) => (
                <Fragment key={u.label}>
                  <span>
                    <button
                      type="button"
                      onClick={() => pick(i)}
                      className={cn(
                        'cursor-pointer transition-colors duration-300',
                        i === cat
                          ? 'text-foreground'
                          : 'text-muted-foreground/50 hover:text-muted-foreground',
                      )}
                    >
                      {u.label}.
                    </button>
                  </span>{' '}
                </Fragment>
              ))}
              <br className="hidden lg:block" />
              <span className="text-muted-foreground/50">And more.</span>
            </h2>
            <div className="mt-8 hidden lg:block">{trending}</div>
          </div>

          <div className="relative flex min-h-[480px] flex-col items-center justify-between gap-4 overflow-hidden rounded-[10px] border bg-card p-5 sm:p-8">
            <div
              className="absolute inset-0 transition-colors duration-500"
              style={{ backgroundColor: theme.background }}
            />

            <div className="relative z-10 flex items-center rounded-md border border-white/12 bg-white/[0.07] px-3 py-1.5 shadow-xl backdrop-blur-md">
              <SlotText
                text={useCase.label.toUpperCase()}
                className="font-mono text-xs uppercase tracking-wide text-white"
              />
            </div>

            <button
              type="button"
              onClick={() => navigate(`/chat/${createChat(prompt.prompt)}`)}
              className="group/prompt relative z-10 flex h-[260px] w-full max-w-[420px] cursor-pointer flex-col rounded-md border border-white/12 bg-white/[0.07] p-5 text-left shadow-xl backdrop-blur-md transition-colors duration-300 hover:bg-white/[0.11]"
            >
              <span
                key={`${cat}-${slide}`}
                className="animate-fade-in-up flex h-full w-full flex-col"
              >
                <span className="flex w-full items-start justify-between gap-3">
                  <span className="font-sans text-base font-medium leading-snug text-white">
                    {prompt.title}
                  </span>
                  <ArrowUpRight className="size-4 shrink-0 text-white/50 transition-colors group-hover/prompt:text-white" />
                </span>
                <span className="mt-auto block h-[108px] w-full overflow-y-auto rounded-[4px] bg-black/25 p-3">
                  <span className="block font-mono text-[13px] leading-[1.6] text-white/80">
                    {prompt.prompt}
                  </span>
                </span>
              </span>
            </button>

            <div className="relative z-10 flex items-center gap-1 rounded-md border border-white/12 bg-white/[0.07] p-1 shadow-xl backdrop-blur-md">
              <button
                type="button"
                aria-label="Previous question"
                onClick={() =>
                  setSlide(
                    (s) =>
                      (s - 1 + useCase.prompts.length) % useCase.prompts.length,
                  )
                }
                className="flex size-8 cursor-pointer items-center justify-center rounded-[3px] text-white/60 transition-colors hover:bg-white/10 hover:text-white"
              >
                <ChevronLeft className="size-4" />
              </button>
              <span className="flex items-center gap-1.5 px-1.5">
                {useCase.prompts.map((_, i) => (
                  <span
                    key={i}
                    className={cn(
                      'size-1 rounded-full transition-colors',
                      i === slide % useCase.prompts.length
                        ? 'bg-white'
                        : 'bg-white/25',
                    )}
                  />
                ))}
              </span>
              <button
                type="button"
                aria-label="Next question"
                onClick={() => setSlide((s) => (s + 1) % useCase.prompts.length)}
                className="flex size-8 cursor-pointer items-center justify-center rounded-[3px] text-white/60 transition-colors hover:bg-white/10 hover:text-white"
              >
                <ChevronRight className="size-4" />
              </button>
            </div>
          </div>

          <div className="lg:hidden">{trending}</div>
        </div>
      </div>
    </section>
  )
}
