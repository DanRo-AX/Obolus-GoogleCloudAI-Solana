import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { SlotText } from '@/components/SlotText'
import { Button } from '@/components/ui/button'
import { TICKER_SOURCES } from '@/data/sources'
import { cn } from '@/lib/utils'
import { useUi } from '@/state/ui'

const ROTATE_MS = 5200

/**
 * Representative MDs from the shelves, rotating. Each turn repaints the point
 * field behind the card in that source's accent. The original site rotated data
 * providers here; putting people in that slot is the whole project.
 */
export function SourceTicker() {
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  const timer = useRef<number | null>(null)
  const navigate = useNavigate()
  const { createChat } = useUi()

  useEffect(() => {
    if (paused) return
    timer.current = window.setTimeout(
      () => setIndex((i) => (i + 1) % TICKER_SOURCES.length),
      ROTATE_MS,
    )
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [index, paused])

  const source = TICKER_SOURCES[index]
  const initial = source.handle.slice(0, 2)

  return (
    <section className="px-4 sm:px-6">
      <div className="w-full">
        <h2 className="max-w-4xl font-sans text-2xl font-[450] sm:text-3xl">
          <span className="text-foreground">The answers worth paying for were never on the web. </span>
          <span className="text-muted-foreground">
            SHELF-1 decides which documents to open,{' '}
          </span>
          <span className="text-foreground">and you pay only for the ones it opened.</span>
        </h2>

        <div className="relative mt-12 overflow-hidden rounded-lg border bg-card">
          <div
            className="absolute inset-0 transition-colors duration-700 ease-in-out"
            style={{ backgroundColor: source.canvasBackground }}
          />

          <div className="relative flex flex-col items-center gap-4 px-6 py-14 sm:px-10 sm:py-20">
            <div
              className="relative accent-border flex min-h-[280px] w-full max-w-[420px] flex-col rounded-md border border-white/12 bg-white/[0.07] p-4 shadow-xl backdrop-blur-md transition-[--card-accent] duration-700 ease-in-out"
              style={{ '--card-accent': source.accent } as React.CSSProperties}
            >
              <div className="flex items-start gap-3">
                <div
                  className="flex size-14 shrink-0 items-center justify-center rounded-md font-mono text-lg font-semibold shadow-md"
                  style={{ backgroundColor: source.accent, color: source.mark }}
                >
                  {initial}
                </div>
                <div className="flex flex-col">
                  <SlotText
                    text={source.handle}
                    className="font-mono text-base uppercase tracking-wide text-white"
                  />
                  <SlotText
                    text={source.label}
                    className="font-mono text-xs uppercase tracking-wide text-white/50"
                  />
                </div>
              </div>

              <div className="flex flex-1 items-center py-4">
                <p className="text-left font-mono text-sm uppercase leading-relaxed text-white/85">
                  {source.description}
                </p>
              </div>

              <div className="flex items-end justify-between gap-4">
                <dl className="flex flex-col gap-1 font-mono text-xs uppercase tracking-wide text-white/45">
                  <div className="flex gap-2">
                    <dt>Entries:</dt>
                    <dd>
                      <SlotText
                        text={source.entries}
                        className="tabular-nums text-white/80"
                      />
                    </dd>
                  </div>
                  <div className="flex gap-2">
                    <dt>Useful:</dt>
                    <dd>
                      <SlotText
                        text={source.openRate}
                        className="tabular-nums text-white/80"
                      />
                    </dd>
                  </div>
                </dl>
                <Button
                  type="button"
                  variant="monoMuted"
                  size="monoSm"
                  className="bg-white text-[#0a0a0a] hover:bg-white/90"
                  onClick={() =>
                    navigate(
                      `/chat/${createChat(
                        `I have a question for people like this: ${source.label}. ${source.description}`,
                      )}`,
                    )
                  }
                >
                  Ask them
                </Button>
              </div>
            </div>

            <div className="flex items-center gap-1.5 rounded-md border border-white/12 bg-white/[0.07] p-2 shadow-xl backdrop-blur-md">
              {TICKER_SOURCES.map((s, i) => (
                <button
                  key={s.id}
                  type="button"
                  aria-label={`View ${s.handle}`}
                  onClick={() => {
                    setIndex(i)
                    setPaused(true)
                    window.setTimeout(() => setPaused(false), ROTATE_MS)
                  }}
                  className={cn(
                    'flex size-9 shrink-0 items-center justify-center rounded-[3px] font-mono text-xs font-semibold transition-all',
                    i === index
                      ? 'ring-2 ring-white'
                      : 'cursor-pointer opacity-50 hover:opacity-100',
                  )}
                  style={{ backgroundColor: s.accent, color: s.mark }}
                >
                  {s.handle.slice(0, 2)}
                </button>
              ))}
              <Link
                to="/shelf"
                className="flex shrink-0 items-center justify-center rounded-[3px] bg-white/12 px-2 py-1 font-mono text-xs font-medium uppercase text-white/85 transition-colors hover:bg-white/20"
              >
                All shelves
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
