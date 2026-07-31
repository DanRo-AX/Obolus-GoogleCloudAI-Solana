import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, ArrowUpRight, TrendingUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/primitives'
import { categoryFor } from '@/data/categories'
import { COVERAGE, GAPS, THIN_BELOW, type Gap } from '@/data/coverage'
import { cn } from '@/lib/utils'
import { useUi } from '@/state/ui'

/**
 * Coverage, not a catalogue. Density per category on top, and underneath the
 * questions people asked that nothing could answer — which is where an open
 * call comes from. Nothing here shows a passage: the passages are the product.
 */
export default function Coverage() {
  const navigate = useNavigate()
  const { createChat, placeOrder } = useUi()
  const [posting, setPosting] = useState<string | null>(null)

  const totals = useMemo(
    () => ({
      docs: COVERAGE.reduce((s, c) => s + c.docs, 0),
      shelves: COVERAGE.reduce((s, c) => s + c.shelves, 0),
      thin: COVERAGE.filter((c) => c.docs < THIN_BELOW).length,
    }),
    [],
  )
  const max = Math.max(...COVERAGE.map((c) => c.docs))

  const postCall = (gap: Gap) => {
    setPosting(gap.id)
    window.setTimeout(() => {
      const chatId = createChat(gap.question)
      placeOrder({
        question: gap.question,
        unitPrice: gap.suggestedPrice,
        target: 7,
        mine: true,
        chatId,
        shelf: gap.category,
        category: categoryFor(gap.category, gap.question),
      })
      navigate('/dashboard')
    }, 620)
  }

  return (
    <div className="page-enter flex-1 overflow-y-auto">
      <div className="space-y-8 p-4 sm:p-6">
        <div className="flex min-h-8 flex-wrap items-center justify-between gap-4">
          <h1 className="font-sans text-base font-medium">Coverage</h1>
          <div className="flex items-center gap-5 font-mono text-xs uppercase tracking-[1px] text-muted-foreground">
            <span>
              <span className="tabular-nums text-foreground">
                {totals.docs.toLocaleString()}
              </span>{' '}
              docs
            </span>
            <span>
              <span className="tabular-nums text-foreground">
                {totals.shelves}
              </span>{' '}
              shelves
            </span>
            <span className="text-destructive">
              <span className="tabular-nums">{totals.thin}</span> thin
            </span>
          </div>
        </div>

        <p className="max-w-2xl text-[15px] leading-7 text-muted-foreground">
          What the shelves can answer right now. You cannot browse the documents
          themselves — that is what opening one is for. What you can see is how
          deep each area runs, and where a question would come back empty.
        </p>

        {/* density ------------------------------------------------------ */}
        <div className="overflow-hidden rounded-[6px] border border-border">
          <div className="grid grid-cols-[1fr_auto] items-center gap-4 border-b border-border bg-muted-2 px-4 py-2.5 font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground sm:grid-cols-[190px_1fr_repeat(3,88px)]">
            <span>Category</span>
            <span className="hidden sm:block">Depth</span>
            <span className="hidden text-right sm:block">Docs</span>
            <span className="hidden text-right sm:block">Avg open</span>
            <span className="text-right">Demand</span>
          </div>

          {COVERAGE.map((c) => {
            const thin = c.docs < THIN_BELOW
            return (
              <div
                key={c.category}
                className="grid grid-cols-[1fr_auto] items-center gap-4 border-b border-border/60 px-4 py-3 text-sm last:border-0 sm:grid-cols-[190px_1fr_repeat(3,88px)]"
              >
                <span className="flex items-center gap-2 font-medium">
                  <span
                    className="size-2 shrink-0 rounded-[1px]"
                    style={{ backgroundColor: c.accent }}
                  />
                  {c.category}
                </span>

                <span className="hidden items-center gap-3 sm:flex">
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-foreground/[0.07]">
                    <span
                      className="block h-full rounded-full transition-[width] duration-700"
                      style={{
                        width: `${Math.round((c.docs / max) * 100)}%`,
                        backgroundColor: c.accent,
                      }}
                    />
                  </span>
                  {thin ? (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-[2px] bg-destructive/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[1px] text-destructive">
                      <AlertTriangle className="size-3" />
                      thin
                    </span>
                  ) : null}
                </span>

                <span className="hidden text-right font-mono text-xs tabular-nums text-muted-foreground sm:block">
                  {c.docs.toLocaleString()}
                </span>
                <span className="hidden text-right font-mono text-xs tabular-nums text-muted-foreground sm:block">
                  ₩{c.avgPrice.toLocaleString()}
                </span>
                <span
                  className={cn(
                    'text-right font-mono text-xs tabular-nums',
                    c.demand > c.docs
                      ? 'text-foreground'
                      : 'text-muted-foreground',
                  )}
                >
                  {c.demand.toLocaleString()}
                </span>
              </div>
            )
          })}
        </div>

        <p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">
          <TrendingUp className="size-3" />
          Demand above docs means the price per open is rising in that area
        </p>

        {/* gaps --------------------------------------------------------- */}
        <div>
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="font-display text-xl font-medium">
              Asked, and nothing answered
            </h2>
            <span className="font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">
              {GAPS.length} open gaps · last 30 days
            </span>
          </div>
          <p className="mt-2 max-w-2xl text-[15px] leading-7 text-muted-foreground">
            Real questions that came back empty. Posting one as an open call is
            how the shelf fills — and whoever answers gets paid every time it is
            quoted afterwards.
          </p>

          <div className="mt-6 grid grid-cols-1 gap-3 lg:grid-cols-2">
            {GAPS.map((g) => (
              <div
                key={g.id}
                className={cn(
                  'flex flex-col rounded-[6px] border border-border bg-card p-5 transition-all duration-500',
                  posting && posting !== g.id && 'scale-[0.99] opacity-30',
                  posting === g.id && 'border-foreground/40 shadow-lg',
                )}
              >
                <div className="flex items-center justify-between gap-3">
                  <Badge className="px-1.5 py-0 uppercase tracking-[1px]">
                    {g.category}
                  </Badge>
                  <span className="font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">
                    asked {g.askedBy}× · {g.lastAsked}
                  </span>
                </div>

                <p className="mt-3 text-[15px] leading-relaxed text-foreground">
                  {g.question}
                </p>

                <div className="mt-5 flex items-center gap-3 border-t border-border pt-4">
                  <span className="font-mono text-xs text-muted-foreground">
                    Suggested{' '}
                    <span className="tabular-nums text-foreground">
                      ₩{g.suggestedPrice.toLocaleString()}
                    </span>{' '}
                    per answer
                  </span>
                  <Button
                    variant="monoMuted"
                    size="mono"
                    className="ml-auto"
                    disabled={posting === g.id}
                    onClick={() => postCall(g)}
                  >
                    {posting === g.id ? 'Posting…' : 'Post a call'}
                    <ArrowUpRight className="size-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-[6px] border border-border bg-foreground/[0.03] p-5">
          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground">
              This page is the honest version of the hardest problem.
            </span>{' '}
            An empty shelf leaves the librarian nothing to do. Everything above
            the fold is what we can already answer; everything below it is what
            we cannot, priced so somebody has a reason to fix it.
          </p>
        </div>
      </div>
    </div>
  )
}
