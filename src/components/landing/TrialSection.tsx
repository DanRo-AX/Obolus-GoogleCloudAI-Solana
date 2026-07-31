import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Info, X } from 'lucide-react'
import { SlotText } from '@/components/SlotText'
import { Button } from '@/components/ui/button'
import {
  CLAUDE_FULL_HTML,
  CLAUDE_RESPONSE_HTML,
  GENERIC_FULL_HTML,
  GENERIC_RESPONSE_HTML,
  SHELF_RESPONSE_HTML,
} from '@/data/comparison'
import { cn } from '@/lib/utils'
import { useUi } from '@/state/ui'

const PROMPT =
  "I have 3 days in Paris and I want the places locals actually go, not the tourist list. Dinner budget is about \u20ac40 a head and I don't want to queue."

const QUOTES = [
  {
    id: 'generic',
    quote:
      '\u201cParis is the kind of city where\u2026 \u2014 that is as far as I can go. Where someone who actually lives there went this month is not in me.\u201d',
    author: 'General LLM · A',
    tail: ', on the same question',
    initial: 'A',
    cardClass: 'bg-foreground',
    quoteClass: 'text-background',
    captionClass: 'bg-background/10 text-background',
    markClass: 'bg-background text-foreground',
    full: GENERIC_FULL_HTML,
  },
  {
    id: 'claude',
    quote:
      '\u201cYou would need to verify this yourself. I cannot see opening hours or local conditions after my training cutoff, so once I strip out what I am unsure of, very little is left.\u201d',
    author: 'General LLM · B',
    tail: ', on the same question',
    initial: 'B',
    cardClass: 'bg-[#E8704E]',
    quoteClass: 'text-white',
    captionClass: 'bg-black/10 text-white',
    markClass: 'bg-white text-[#E8704E]',
    full: CLAUDE_FULL_HTML,
  },
] as const

const CHALLENGERS = {
  generic: { label: 'General LLM · A', html: GENERIC_RESPONSE_HTML },
  claude: { label: 'General LLM · B', html: CLAUDE_RESPONSE_HTML },
} as const

/** One question, two kinds of answer. This is where the claim gets proven. */
export function TrialSection() {
  const [challenger, setChallenger] = useState<'generic' | 'claude'>('generic')
  const [dialog, setDialog] = useState<(typeof QUOTES)[number] | null>(null)
  const navigate = useNavigate()
  const { createChat } = useUi()

  return (
    <section className="px-4 sm:px-6">
      <div className="w-full">
        <h2 className="max-w-4xl font-sans text-2xl font-[450] text-foreground sm:text-3xl">
          We asked the same question in two places.
        </h2>

        <div className="mt-12 grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-6">
          {QUOTES.map((q) => (
            <figure
              key={q.id}
              className={cn(
                'flex flex-col overflow-hidden rounded-[4px]',
                q.cardClass,
              )}
            >
              <div className="flex-1 p-6 sm:p-8">
                <span
                  className={cn(
                    'flex size-7 items-center justify-center rounded-[2px] font-mono text-sm font-semibold',
                    q.markClass,
                  )}
                >
                  {q.initial}
                </span>
                <blockquote
                  className={cn(
                    'mt-8 font-sans text-xl font-[450] leading-snug sm:text-2xl',
                    q.quoteClass,
                  )}
                >
                  {q.quote}
                </blockquote>
              </div>
              <figcaption
                className={cn(
                  'flex items-center justify-between gap-4 px-4 py-3.5 font-mono text-xs font-medium uppercase tracking-[1px]',
                  q.captionClass,
                )}
              >
                <span>
                  <span className="font-semibold">{q.author}</span>
                  <span className="opacity-60">{q.tail}</span>
                </span>
                <button
                  type="button"
                  aria-label="View full response"
                  onClick={() => setDialog(q)}
                  className="shrink-0 cursor-pointer opacity-60 transition-opacity hover:opacity-100"
                >
                  <Info className="size-4" />
                </button>
              </figcaption>
            </figure>
          ))}
        </div>

        <div className="mx-auto mt-20 flex w-full max-w-3xl flex-col gap-3">
          <div className="flex items-center justify-between gap-4">
            <span className="font-mono text-xs font-medium uppercase tracking-[1px] text-muted-foreground">
              Prompt
            </span>
            <Button
              type="button"
              variant="monoGhost"
              size="monoSm"
              onClick={() => navigate(`/chat/${createChat(PROMPT)}`)}
            >
              Try it
            </Button>
          </div>
          <div className="rounded-[4px] bg-foreground/[0.05] p-3">
            <span className="block font-mono text-[13px] leading-[1.6] text-foreground">
              {PROMPT}
            </span>
          </div>
        </div>

        <div className="mt-8 flex snap-x snap-mandatory gap-4 overflow-x-auto scrollbar-none md:grid md:grid-cols-2 md:gap-6 md:overflow-visible">
          <Panel
            header={
              <>
                {(['generic', 'claude'] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    aria-label={`View ${CHALLENGERS[k].label} response`}
                    onClick={() => setChallenger(k)}
                    className={cn(
                      'flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-[2px] font-mono text-xs font-semibold transition-opacity',
                      k === 'generic'
                        ? 'bg-foreground text-background'
                        : 'bg-[#E8704E] text-white',
                      challenger === k
                        ? 'opacity-100'
                        : 'opacity-30 hover:opacity-60',
                    )}
                  >
                    {k === 'generic' ? 'A' : 'B'}
                  </button>
                ))}
                <SlotText
                  text={CHALLENGERS[challenger].label.toUpperCase()}
                  className="font-mono text-xs font-medium uppercase tracking-[1px] text-muted-foreground"
                />
              </>
            }
            html={CHALLENGERS[challenger].html}
          />

          <Panel
            header={
              <>
                <span className="flex size-7 shrink-0 items-center justify-center rounded-[2px] bg-foreground">
                  <img className="size-4 invert" alt="" src="/SHELF-SYMBOL.svg" />
                </span>
                <span className="font-mono text-xs font-medium uppercase tracking-[1px] text-muted-foreground">
                  SHELF-1
                </span>
              </>
            }
            html={SHELF_RESPONSE_HTML}
          />
        </div>

        <p className="mt-10 text-center font-mono text-xs font-medium uppercase tracking-[1px] text-muted-foreground">
          7 opens · ₩2,100 · settled over x402
        </p>
      </div>

      {dialog ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setDialog(null)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Full response"
            className="relative z-10 flex max-h-[80vh] w-full max-w-lg flex-col gap-4 border bg-background p-6 shadow-lg sm:max-w-2xl sm:rounded-[4px]"
          >
            <div className="flex items-center justify-between gap-4">
              <span className="font-mono text-xs font-medium uppercase tracking-[1px] text-muted-foreground">
                Full response
              </span>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setDialog(null)}
                className="cursor-pointer text-muted-foreground transition-colors hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>
            <div
              className="md-body min-h-0 flex-1 overflow-y-auto break-words text-sm"
              dangerouslySetInnerHTML={{ __html: dialog.full }}
            />
          </div>
        </div>
      ) : null}
    </section>
  )
}

function Panel({ header, html }: { header: React.ReactNode; html: string }) {
  return (
    <div className="flex w-[80vw] shrink-0 snap-start flex-col overflow-hidden rounded-[4px] border bg-card md:w-auto">
      <div className="flex h-10 shrink-0 items-center gap-2.5 border-b border-border bg-gradient-to-b from-[#F9F9FA] to-[#E2E2E6] px-2">
        {header}
      </div>
      <div className="relative min-h-0">
        <div className="max-h-[65svh] overflow-y-auto overscroll-contain p-4 sm:p-5 md:max-h-[60vh]">
          <div
            className="md-body break-words text-sm"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-card to-transparent" />
      </div>
    </div>
  )
}
