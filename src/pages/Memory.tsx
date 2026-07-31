import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Coins, Flame, ShieldAlert, Sparkles, Star, Wallet } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Badge,
  Switch,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/primitives'
import { STRIKE_LIMIT } from '@/data/onboarding'
import { cn } from '@/lib/utils'
import { useUi } from '@/state/ui'
import { shortKey } from '@/state/wallet'

/**
 * Screen 03 — My memory. Everything you have answered piles up here.
 * The thicker it gets, the better auto-match sticks, until money arrives without
 * you answering anything new. Recency weighting is shown, not hidden.
 */
export default function Memory() {
  const { memory, autoMatch, setAutoMatch, profile, disputeStrike } = useUi()

  const settled = memory.filter((m) => m.status !== 'voided')
  const total = settled.reduce((s, m) => s + m.earned, 0)
  const autoEarned = settled
    .filter((m) => m.via === 'Auto-match')
    .reduce((s, m) => s + m.earned, 0)
  const voided = memory.filter((m) => m.status === 'voided')

  const shelves = useMemo(() => {
    const map = new Map<string, number>()
    for (const m of memory) map.set(m.shelf, (map.get(m.shelf) ?? 0) + 1)
    return [...map.entries()].sort((a, b) => b[1] - a[1])
  }, [memory])

  /** Recent entries weigh more, old ones fade — the memory stream's weighting. */
  const weightOf = (ts: number) => {
    const days = (Date.now() - ts) / (1000 * 60 * 60 * 24)
    return Math.max(0.2, Math.min(1, 1 - days / 90))
  }

  return (
    <div className="page-enter flex-1 overflow-y-auto">
      <div className="space-y-6 p-4 sm:p-6">
        <div className="flex min-h-8 items-center justify-between gap-4">
          <h1 className="font-sans text-base font-medium">My memory</h1>
          <Button asChild variant="monoGhost" size="monoSm">
            <Link to="/dashboard">Browse open calls</Link>
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Stat
            icon={<Coins className="size-3.5" />}
            label="Settled to date"
            value={`₩${total.toLocaleString()}`}
            sub="x402 · USDC on Solana"
          />
          <Stat
            icon={<Sparkles className="size-3.5" />}
            label="Earned via auto-match"
            value={`₩${autoEarned.toLocaleString()}`}
            sub={`${total ? Math.round((autoEarned / total) * 100) : 0}% of everything`}
          />
          <Stat
            icon={<Flame className="size-3.5" />}
            label="Memory entries"
            value={`${settled.length}`}
            sub={`across ${shelves.length} shelves`}
          />
        </div>

        {profile ? (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-[6px] border border-border bg-card px-4 py-3 font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Wallet className="size-3.5" />
              Payouts to{' '}
              {profile.wallet ? (
                <span className="text-foreground">
                  {shortKey(profile.wallet)}
                </span>
              ) : (
                <Link
                  to="/onboarding"
                  className="text-foreground underline decoration-dotted underline-offset-4"
                >
                  no wallet connected
                </Link>
              )}
            </span>
            <span
              className={cn(
                'flex items-center gap-1.5',
                profile.strikes > 0 && 'text-destructive',
              )}
            >
              <ShieldAlert className="size-3.5" />
              {profile.strikes}/{STRIKE_LIMIT} strikes
            </span>
            <span className="ml-auto">
              {profile.disputeUsed ? 'Dispute spent' : '1 dispute available'}
            </span>
          </div>
        ) : null}

        {voided.length ? (
          <div className="rounded-[6px] border border-destructive/30 bg-destructive/[0.04] px-4 py-3">
            <p className="text-sm leading-relaxed text-muted-foreground">
              <span className="font-medium text-destructive">
                {voided.length} answer{voided.length > 1 ? 's' : ''} voided.
              </span>{' '}
              Voided entries stay in the stream so you can see what tripped, but
              they are not quoted and they do not count toward the balance.
            </p>
          </div>
        ) : null}

        {/* Auto-match — the line you leave in the water ------------------ */}
        <div className="flex flex-wrap items-center gap-4 rounded-[6px] border border-border bg-card p-4">
          <Switch
            checked={autoMatch}
            onCheckedChange={setAutoMatch}
            aria-label="Auto-match"
          />
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="text-[15px] font-medium">Auto-match</span>
            <span className="text-sm leading-relaxed text-muted-foreground">
              Leave it on and your memory gets quoted the moment it fits a
              query — no open call, no waiting. You get paid per quote without
              answering anything new.
            </span>
          </div>
        </div>

        {/* Shelf spread ------------------------------------------------ */}
        {shelves.length ? (
          <div className="flex flex-wrap gap-1.5">
            {shelves.map(([name, n]) => (
              <span
                key={name}
                className="inline-flex items-center gap-1.5 rounded-[3px] bg-foreground/[0.06] px-2.5 py-1 text-sm"
              >
                {name}
                <Badge>{n}</Badge>
              </span>
            ))}
          </div>
        ) : null}

        {/* Memory stream ----------------------------------------------- */}
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">
            Memory stream
          </p>
          {memory.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-[18vh] text-center">
              <h2 className="font-sans text-lg font-medium">Nothing here yet</h2>
              <p className="max-w-[320px] text-sm leading-relaxed text-muted-foreground">
                Answer one open call and it starts here. The more it holds, the
                better auto-match sticks — eventually money arrives without you
                answering anything.
              </p>
              <Button asChild variant="mono" size="mono" className="mt-2">
                <Link to="/dashboard">Browse open calls</Link>
              </Button>
            </div>
          ) : (
            <ol className="mt-3 flex flex-col">
              {memory.map((m, i) => {
                const w = weightOf(m.createdAt)
                return (
                  <li key={m.id} className="flex gap-4">
                    <div className="flex flex-col items-center">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span
                            className="mt-1.5 size-2 shrink-0 cursor-help rounded-full bg-foreground"
                            style={{ opacity: w }}
                          />
                        </TooltipTrigger>
                        <TooltipContent side="right">
                          Weight {Math.round(w * 100)}% — recent entries count
                          for more
                        </TooltipContent>
                      </Tooltip>
                      {i < memory.length - 1 ? (
                        <span className="w-px flex-1 bg-border" />
                      ) : null}
                    </div>
                    <div className="flex-1 pb-6">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="font-mono text-[11px] uppercase tracking-[1px] text-muted-foreground">
                          {m.shelf}
                        </span>
                        <span
                          className={cn(
                            'rounded-[2px] px-1.5 py-0 font-mono text-[10px] uppercase tracking-[1px]',
                            m.via === 'Auto-match'
                              ? 'bg-[#0F766E]/10 text-[#0F766E]'
                              : 'bg-foreground/10 text-foreground',
                          )}
                        >
                          {m.via}
                        </span>
                        {m.rating ? (
                          <span className="flex items-center gap-0.5 font-mono text-[10px] tabular-nums text-muted-foreground">
                            <Star className="size-3 fill-current" />
                            {m.rating}.0
                          </span>
                        ) : null}
                        <span
                          className={cn(
                            'ml-auto font-mono text-xs tabular-nums',
                            m.status === 'voided'
                              ? 'text-muted-foreground/60 line-through'
                              : 'text-muted-foreground',
                          )}
                        >
                          +₩{m.earned.toLocaleString()}
                        </span>
                      </div>
                      <p className="mt-1.5 text-sm text-muted-foreground">
                        {m.question}
                      </p>
                      <p
                        className={cn(
                          'mt-1 text-[15px] leading-relaxed',
                          m.status === 'voided'
                            ? 'text-foreground/50'
                            : 'text-foreground/90',
                        )}
                      >
                        {m.answer}
                      </p>

                      {m.status === 'voided' ? (
                        <div className="mt-3 rounded-[4px] border border-destructive/25 bg-destructive/[0.04] p-3">
                          <p className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[1px] text-destructive">
                            <ShieldAlert className="size-3" />
                            Voided · {m.flags?.[0]?.rule ?? 'Low-effort answers'}
                          </p>
                          {m.flags?.map((f) => (
                            <p
                              key={f.detail}
                              className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground"
                            >
                              {f.detail}
                            </p>
                          ))}
                          <div className="mt-3 flex items-center gap-3">
                            <Button
                              variant="monoMuted"
                              size="monoSm"
                              disabled={profile?.disputeUsed}
                              onClick={() => disputeStrike(m.id)}
                            >
                              {profile?.disputeUsed
                                ? 'Dispute spent'
                                : 'Dispute this'}
                            </Button>
                            <span className="font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">
                              One per account
                            </span>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </li>
                )
              })}
            </ol>
          )}
        </div>

        {/* Trust guarantees — the conditions the meeting set ------------ */}
        <div className="rounded-[6px] border border-border bg-foreground/[0.03] p-4">
          <p className="text-sm leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground">
              Delete your account and it all burns.
            </span>{' '}
            Your MDs and memory stream drop out of search immediately on
            request and are destroyed. All a buyer ever receives is an anonymous
            handle and the passage they paid for. We never collect bank details,
            card numbers, or national ID.
          </p>
        </div>
      </div>
    </div>
  )
}

function Stat({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode
  label: string
  value: string
  sub: string
}) {
  return (
    <div className="rounded-[6px] border border-border bg-card p-4">
      <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-2 font-host text-[26px] font-medium leading-none tabular-nums">
        {value}
      </div>
      <div className="mt-1.5 text-xs text-muted-foreground">{sub}</div>
    </div>
  )
}
