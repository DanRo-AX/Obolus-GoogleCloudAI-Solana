import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, X } from 'lucide-react'
import { FaqSection } from '@/components/FaqSection'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/primitives'
import { PRICING_FAQ } from '@/data/faq'
import {
  FEATURE_TOOLTIPS,
  PLANS,
  PROMPT_TYPES,
  PROVIDER_CHIPS,
  type Plan,
} from '@/data/pricing'
import { cn } from '@/lib/utils'

export default function Pricing() {
  return (
    <div className="page-enter flex-1 overflow-y-auto">
      <section className="px-5 pb-6 pt-6 sm:px-8 sm:pb-8 sm:pt-8 lg:px-12">
        <div className="mx-auto max-w-[76rem]">
          <h2 className="font-inter text-xl font-medium">
            Pay for what you actually open
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Your balance is drawn down per document opened. Nothing else.
          </p>
          <div className="mt-5 max-w-3xl rounded-[6px] border border-border bg-card px-4 py-3 text-sm leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground">What works today:</span>{' '}
            the Devnet demo pays each quoted document directly in USDC. Monthly
            top-ups below are the projected mainnet packaging, not an active
            subscription checkout.
          </div>
        </div>
      </section>

      <section className="px-5 pb-24 pt-0 sm:px-8 sm:pb-32 sm:pt-0 lg:px-12">
        <div className="mx-auto max-w-[76rem]">
          <div className="flex snap-x snap-mandatory gap-4 overflow-x-auto px-2 py-2 scrollbar-none md:grid md:grid-cols-2 md:gap-4 md:overflow-visible md:px-0 md:py-0 md:[scroll-snap-type:none] lg:grid-cols-4">
            {PLANS.map((plan) => (
              <PlanCard key={plan.id} plan={plan} />
            ))}
          </div>

          <div className="mt-10 flex flex-col gap-6 rounded-[6px] bg-foreground/[0.04] p-8 sm:flex-row sm:items-center sm:justify-between">
            <div className="max-w-2xl">
              <h3 className="font-host text-2xl font-semibold uppercase tracking-[1px]">
                Teams & Enterprise
              </h3>
              <p className="mt-2 text-base leading-relaxed text-muted-foreground">
                Shared balance and seats, with per-open pricing set to your volume.
              </p>
            </div>
            <Button asChild variant="mono" size="monoLg" className="shrink-0">
              <a href="https://t.me/openshelf" target="_blank" rel="noreferrer">
                Contact us
              </a>
            </Button>
          </div>

          <PlanEstimator />
        </div>
      </section>

      <FaqSection items={PRICING_FAQ} className="pb-32 pt-0" />
    </div>
  )
}

function PlanCard({ plan }: { plan: Plan }) {
  return (
    <div className="flex shrink-0 basis-full snap-center flex-col md:shrink md:basis-auto">
      <div className="flex h-full flex-col">
        <div
          className={cn(
            'accent-border relative flex flex-1 flex-col overflow-hidden rounded-[6px] border border-transparent bg-gradient-to-bl to-card text-foreground',
            plan.from,
          )}
          style={{ '--card-accent': plan.accent } as React.CSSProperties}
        >
          <div className="mx-5 mt-5 flex min-h-[160px] flex-col rounded-[6px] bg-foreground/[0.045] p-4">
            <h3 className="font-host text-[24px] font-semibold uppercase tracking-[1px] text-foreground">
              {plan.name}
            </h3>
            <p className="mt-0.5 min-h-[36px] text-[15px] leading-relaxed text-muted-foreground">
              {plan.tagline}
            </p>
            <div className="flex flex-1 flex-col justify-center">
              <div className="flex flex-wrap items-end gap-x-3 gap-y-0.5">
                <span className="font-host text-[27px] font-medium leading-none tracking-tight tabular-nums text-foreground">
                  {plan.credits}
                </span>
                <div className="flex flex-col leading-tight">
                  <span className="flex items-center gap-1 text-[15px] font-medium text-foreground">
                    <Hint label="Opens per month" />
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-1 flex-col gap-4 p-5">
            <div className="text-[17px] text-foreground">
              <span className="font-host text-[25px] font-bold">
                {plan.price}
              </span>{' '}
              <span className="text-[13px] text-muted-foreground">
                / month
              </span>
            </div>

            <div className="group/cta relative isolate mb-4 mt-2">
              <Button
                asChild
                variant="mono"
                size="monoLg"
                className="w-full bg-foreground/90 hover:bg-foreground"
              >
                <Link to={plan.href}>{plan.cta}</Link>
              </Button>
              {plan.glow ? (
                <span
                  className="pointer-events-none absolute inset-x-4 top-1/2 -z-10 h-7 -translate-y-1/2 rounded-full opacity-40 blur-lg transition-opacity duration-300 group-hover/cta:opacity-80"
                  style={{ backgroundColor: plan.glow }}
                />
              ) : null}
            </div>

            <ul className="flex flex-col gap-2.5">
              <li
                className="accent-border relative isolate flex flex-col gap-3 overflow-hidden rounded-[6px] bg-[#0F766E]/[0.06] p-3"
                style={{ '--card-accent': '#0F766E4d' } as React.CSSProperties}
              >
                <span className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-24 bg-[radial-gradient(65%_100%_at_50%_115%,#14B8A699,transparent_65%)] blur-2xl" />
                <span className="font-mono text-xs font-semibold uppercase tracking-[1.5px] text-foreground">
                  SHELF-1
                </span>
                <span className="flex items-center gap-1.5 text-[13px] font-medium text-foreground/80">
                  <Check className="h-3 w-3 shrink-0 text-foreground" />
                  <span>Full SHELF-1 access</span>
                </span>
              </li>

              <Feature label="Auto-matching" />
              <Feature label="Open calls" />

              <li
                className="accent-border relative isolate flex flex-col gap-2 overflow-hidden rounded-[6px] bg-[#2563EB]/[0.05] p-3"
                style={{ '--card-accent': '#2563EB4d' } as React.CSSProperties}
              >
                <span className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-24 bg-[radial-gradient(65%_100%_at_50%_115%,#3B82F699,transparent_65%)] blur-2xl" />
                <div className="flex flex-wrap gap-2">
                  {PROVIDER_CHIPS.map((p) => (
                    <Tooltip key={p.name}>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          aria-label={p.name}
                          className={cn(
                            'flex size-5 cursor-help items-center justify-center overflow-hidden rounded-[3px] bg-foreground/10',
                            p.plate,
                          )}
                        >
                          <span className="font-mono text-[9px] font-semibold">
                            {p.name.slice(0, 2)}
                          </span>
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>{p.name}</TooltipContent>
                    </Tooltip>
                  ))}
                </div>
                <div className="flex items-center gap-1.5 text-[13px] font-medium text-foreground/80">
                  <Check className="h-3 w-3 shrink-0 text-foreground" />
                  <Hint label="Full shelf access" />
                </div>
                <span className="flex items-center gap-1.5 text-[13px] font-medium text-foreground/80">
                  <Check className="h-3 w-3 shrink-0 text-foreground" />
                  <span>Every shelf, every plan</span>
                </span>
              </li>

              <Feature label="Source verification" />
              <Feature label="x402 settlement" />
              <Feature label="Telegram support" plain />

              <li
                className={cn(
                  'flex items-center gap-1.5 text-[13px] font-medium',
                  plan.lowestCost
                    ? 'text-foreground/80'
                    : 'text-muted-foreground/70',
                )}
              >
                {plan.lowestCost ? (
                  <Check className="h-3 w-3 shrink-0 text-foreground" />
                ) : (
                  <X className="h-3 w-3 shrink-0 text-muted-foreground" />
                )}
                <span>Lowest cost per open</span>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}

function Feature({ label, plain }: { label: string; plain?: boolean }) {
  return (
    <li className="flex items-center gap-1.5 text-[13px] font-medium text-foreground/80">
      <Check className="h-3 w-3 shrink-0 text-foreground" />
      {plain ? <span>{label}</span> : <Hint label={label} />}
    </li>
  )
}

function Hint({ label }: { label: string }) {
  const copy = FEATURE_TOOLTIPS[label]
  if (!copy) return <span>{label}</span>
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="cursor-help underline decoration-dotted decoration-foreground/30 underline-offset-2 transition-colors hover:decoration-foreground/70">
          {label}
        </span>
      </TooltipTrigger>
      <TooltipContent>{copy}</TooltipContent>
    </Tooltip>
  )
}

/** "Find the right plan" — prompt mix + volume picks a recommended plan. */
function PlanEstimator() {
  const [type, setType] = useState<(typeof PROMPT_TYPES)[number]['id']>('mixed')
  const [queries, setQueries] = useState(60)

  const promptType = PROMPT_TYPES.find((p) => p.id === type)!

  const { plan, low, high } = useMemo(() => {
    const mid = queries * promptType.creditsPerQuery
    const lo = Math.round(mid * 0.6)
    const hi = Math.round(mid * 2.4)
    const match =
      PLANS.find(
        (p) => Number(p.credits.replace(/,/g, '')) >= hi,
      ) ?? PLANS[PLANS.length - 1]
    return { plan: match, low: lo, high: hi }
  }, [queries, promptType])

  const pct = Math.min(
    100,
    Math.round((high / Number(plan.credits.replace(/,/g, ''))) * 100),
  )

  return (
    <div className="mt-24">
      <h3 className="font-inter text-xl font-medium">
        Find the right plan
      </h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Tell us how you ask, and we will size the balance
      </p>

      <div className="mt-10 grid gap-10 lg:grid-cols-2 lg:gap-16">
        <div>
          <div className="flex items-center gap-3">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-foreground/[0.08] font-mono text-sm font-medium">
              1
            </span>
            <h4 className="font-sans text-lg font-medium">
              What kind of questions do you ask?
            </h4>
          </div>
          <div className="mt-5 flex flex-wrap gap-3">
            {PROMPT_TYPES.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setType(p.id)}
                className={cn(
                  'h-[68px] min-w-[140px] cursor-pointer rounded-[4px] px-5 text-base font-medium transition-colors',
                  type === p.id
                    ? 'bg-[#23008E] text-white'
                    : 'bg-muted-2 text-foreground hover:bg-muted',
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
          <p className="mt-4 text-base text-muted-foreground">
            {promptType.blurb}
          </p>

          <div className="mt-10 flex items-center gap-3">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-foreground/[0.08] font-mono text-sm font-medium">
              2
            </span>
            <h4 className="font-sans text-lg font-medium">
              How many questions a month?
            </h4>
          </div>
          <div className="mt-5">
            <div className="relative flex h-[62px] items-center overflow-hidden rounded-[4px] bg-muted-2">
              <div
                className="absolute inset-y-0 left-0 bg-[#23008E]"
                style={{ width: `${Math.max(6, (queries / 400) * 100)}%` }}
              />
              <div className="relative z-10 flex w-full items-center justify-between px-5">
                <div className="leading-tight">
                  <div className="text-base font-medium">
                    {queries >= 400 ? '400+' : queries} questions
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {Math.max(1, Math.round(queries / 20))} /day
                  </div>
                </div>
              </div>
              <input
                type="range"
                min={1}
                max={400}
                value={queries}
                aria-label="Questions per month"
                onChange={(e) => setQueries(Number(e.target.value))}
                className="absolute inset-0 z-20 h-full w-full cursor-ew-resize opacity-0"
              />
            </div>
            <div className="mt-1 flex justify-between font-sans text-sm text-muted-foreground">
              <span>1</span>
              <span>400+</span>
            </div>
          </div>
        </div>

        <div className="relative min-h-[520px] overflow-hidden rounded-[6px]">
          <div
            className="absolute inset-0 transition-colors duration-500"
            style={{ backgroundColor: '#0d0d10' }}
          />
          <div className="absolute inset-0 flex items-center justify-center p-6">
            <div className="w-full max-w-[360px] rounded-[6px] border border-white/15 bg-white/70 p-6 shadow-xl backdrop-blur-md">
              <h4 className="font-host text-2xl font-semibold uppercase tracking-[1px]">
                {plan.name}
              </h4>
              <div className="mt-3 flex items-end gap-2">
                <span className="font-host text-[28px] font-medium leading-none tabular-nums">
                  {plan.credits}
                </span>
                <span className="text-[15px] font-medium">opens / month</span>
              </div>

              <div className="mt-6 flex items-center justify-between text-sm">
                <span className="font-medium">Expected monthly opens</span>
                <span className="tabular-nums text-muted-foreground">
                  {low.toLocaleString()}–{high.toLocaleString()}
                </span>
              </div>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-foreground/10">
                <div
                  className="h-full rounded-full bg-[#23008E] transition-[width] duration-300"
                  style={{ width: `${pct}%` }}
                />
              </div>

              <ul className="mt-6 flex flex-col gap-2 text-sm">
                {[
                  'Full SHELF-1 access',
                  'Full shelf access',
                  'Open calls',
                ].map((f) => (
                  <li key={f} className="flex items-center gap-2">
                    <Check className="size-3.5 shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>

              <div className="mt-6 text-[17px]">
                <span className="font-host text-[25px] font-bold">
                  {plan.price}
                </span>{' '}
                <span className="text-[13px] text-muted-foreground">
                  / month
                </span>
              </div>

              <Button
                asChild
                variant="mono"
                size="monoLg"
                className="mt-4 w-full"
              >
                <Link to={plan.href}>Choose {plan.name}</Link>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
