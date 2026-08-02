import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { Coins, Flame, Loader2, ShieldAlert, Sparkles, Star, Trash2, Wallet } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Badge,
  Switch,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/primitives'
import { AUTO_MATCH_STRIKE_LIMIT, STRIKE_LIMIT } from '@/data/onboarding'
import { cn } from '@/lib/utils'
import { useUi } from '@/state/ui'
import { shortKey } from '@/state/wallet'

/**
 * Screen 03 — My memory. Everything you have answered piles up here.
 * The thicker it gets, the better auto-match sticks, until money arrives without
 * you answering anything new. Recency weighting is shown, not hidden.
 */
export default function Memory() {
  const {
    memory,
    earnings,
    autoMatch,
    setAutoMatch,
    profile,
    disputeStrike,
    refreshLedger,
    account,
    authReady,
    balance,
    deleteCurrentAccount,
  } = useUi()
  const navigate = useNavigate()
  const [disputingId, setDisputingId] = useState<string | null>(null)
  const [draftDisputeId, setDraftDisputeId] = useState<string | null>(null)
  const [disputeReason, setDisputeReason] = useState('')
  const [disputeError, setDisputeError] = useState<string | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const dispute = async (memoryId: string) => {
    if (disputingId) return
    setDisputingId(memoryId)
    setDisputeError(null)
    try {
      await disputeStrike(memoryId, disputeReason)
      setDraftDisputeId(null)
      setDisputeReason('')
    } catch (error) {
      setDisputeError(
        error instanceof Error ? error.message : 'The dispute could not be submitted.',
      )
    } finally {
      setDisputingId(null)
    }
  }

  const settled = memory.filter((m) => m.status !== 'voided')
  const total =
    earnings?.accruedKrw ?? settled.reduce((sum, entry) => sum + entry.earned, 0)
  const answeredViaAutoMatch = settled
    .filter((m) => m.via === 'Auto-match')
    .reduce((s, m) => s + m.earned, 0)
  const documentOpenEarnings =
    earnings?.events
      .filter((event) => event.source === 'document_open')
      .reduce((sum, event) => sum + event.amountKrw, 0) ?? 0
  const autoEarned = answeredViaAutoMatch + documentOpenEarnings
  const voided = memory.filter((m) => m.status === 'voided')

  useEffect(() => {
    void refreshLedger().catch(() => undefined)
  }, [refreshLedger])

  const shelves = useMemo(() => {
    const map = new Map<string, number>()
    for (const m of memory) map.set(m.shelf, (map.get(m.shelf) ?? 0) + 1)
    return [...map.entries()].sort((a, b) => b[1] - a[1])
  }, [memory])

  /** Recent entries weigh more, old ones fade — the memory stream's weighting. */
  const weightOf = (ts: number) => {
    const days = (Date.now() - ts) / (1000 * 60 * 60 * 24)
    return Math.max(0.2, Math.min(1, 2 ** (-days / 90)))
  }

  if (!authReady) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    )
  }
  if (!account) return <Navigate to="/login" replace />

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
            label="Accrued to date"
            value={`₩${total.toLocaleString()}`}
            sub={`${earnings?.eventCount ?? settled.length} earning events${earnings?.heldKrw ? ` · ₩${earnings.heldKrw.toLocaleString()} held` : ''}`}
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

        {balance ? (
          <div className="flex flex-wrap gap-x-6 gap-y-2 rounded-[6px] border border-border bg-card px-4 py-3 font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">
            <span>Sandbox available <strong className="text-foreground">₩{balance.availableKrw.toLocaleString()}</strong></span>
            <span>Reserved <strong className="text-foreground">₩{balance.reservedKrw.toLocaleString()}</strong></span>
            <span>Held <strong className="text-foreground">₩{balance.heldKrw.toLocaleString()}</strong></span>
          </div>
        ) : null}

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
            disabled={(profile?.strikes ?? 0) >= AUTO_MATCH_STRIKE_LIMIT}
            aria-label="Auto-match"
          />
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="text-[15px] font-medium">Auto-match</span>
            <span className="text-sm leading-relaxed text-muted-foreground">
              {(profile?.strikes ?? 0) >= AUTO_MATCH_STRIKE_LIMIT
                ? 'Paused by the two-strike restriction. New payouts are held for 14 days; a successful dispute lifts the matching strike.'
                : 'Leave it on and your memory gets quoted the moment it fits a query — no open call, no waiting. You get paid per quote without answering anything new.'}
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

        {earnings?.events.length ? (
          <div>
            <div className="flex items-center justify-between gap-4">
              <p className="font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">
                Earnings ledger
              </p>
              <span className="font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">
                append-only · accrued
              </span>
            </div>
            <ol className="mt-3 overflow-hidden rounded-[6px] border border-border bg-card">
              {earnings.events.slice(0, 6).map((event) => (
                <li
                  key={event.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border/70 px-3 py-2.5 last:border-0"
                >
                  <span className="font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">
                    {event.source.replaceAll('_', ' ')}
                  </span>
                  {event.documentHandle ? (
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {event.documentHandle}
                    </span>
                  ) : null}
                  <span className="text-xs text-muted-foreground">
                    {event.recipientWallet
                      ? `to ${shortKey(event.recipientWallet)}`
                      : 'wallet not set at accrual'}
                  </span>
                  {event.payoutStatus === 'held' ? (
                    <span className="rounded-[2px] bg-amber-500/10 px-1.5 font-mono text-[9px] uppercase tracking-[1px] text-amber-700">
                      held 14d
                    </span>
                  ) : null}
                  {event.payoutStatus === 'onchain' ? (
                    <span className="rounded-[2px] bg-emerald-500/10 px-1.5 font-mono text-[9px] uppercase tracking-[1px] text-emerald-700">
                      paid onchain
                    </span>
                  ) : null}
                  <span className="ml-auto font-mono text-xs tabular-nums text-[#0F766E]">
                    +₩{event.amountKrw.toLocaleString()}
                  </span>
                </li>
              ))}
            </ol>
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

                      {m.interviewResponses?.length ? (
                        <details className="mt-3 rounded-[4px] border border-border/70 bg-muted/25 px-3 py-2">
                          <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">
                            Interview context · {m.interviewResponses.length} turns · private
                          </summary>
                          <ol className="mt-3 space-y-3">
                            {m.interviewResponses.map((response) => (
                              <li key={response.questionId}>
                                <p className="text-xs text-muted-foreground">
                                  {response.prompt}
                                </p>
                                <p className="mt-0.5 text-sm text-foreground/85">
                                  {response.answer}
                                </p>
                              </li>
                            ))}
                          </ol>
                        </details>
                      ) : null}

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
                              disabled={profile?.disputeUsed || Boolean(disputingId) || m.disputeStatus === 'pending'}
                              onClick={() => setDraftDisputeId(m.id)}
                            >
                              {disputingId === m.id ? (
                                <Loader2 className="size-3 animate-spin" />
                              ) : m.disputeStatus === 'pending' ? (
                                'Review pending'
                              ) : profile?.disputeUsed ? (
                                'Dispute spent'
                              ) : (
                                'Dispute this'
                              )}
                            </Button>
                            <span className="font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">
                              One per account
                            </span>
                          </div>
                          {draftDisputeId === m.id ? (
                            <div className="mt-3 grid gap-2">
                              <textarea
                                value={disputeReason}
                                onChange={(event) => setDisputeReason(event.target.value)}
                                rows={3}
                                maxLength={1000}
                                placeholder="Explain what specific evidence the automatic check missed (20+ characters)."
                                className="w-full resize-y rounded-[3px] border border-border bg-background p-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-foreground/30"
                              />
                              <div className="flex gap-2">
                                <Button
                                  variant="mono"
                                  size="monoSm"
                                  disabled={disputeReason.trim().length < 20}
                                  onClick={() => void dispute(m.id)}
                                >
                                  Submit for review
                                </Button>
                                <Button
                                  variant="monoGhost"
                                  size="monoSm"
                                  onClick={() => setDraftDisputeId(null)}
                                >
                                  Cancel
                                </Button>
                              </div>
                            </div>
                          ) : null}
                          {disputeError ? (
                            <p className="mt-2 text-[13px] text-destructive">
                              {disputeError}
                            </p>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </li>
                )
              })}
            </ol>
          )}
        </div>

        <div className="rounded-[6px] border border-border bg-foreground/[0.03] p-4">
          <p className="text-sm leading-relaxed text-muted-foreground">
            Deleting the account refunds unused open-call escrow, removes profile,
            memory and documents, revokes every session, and anonymizes the
            append-only financial audit rows.
          </p>
          <div className="mt-3 flex items-center gap-2">
            {deleteConfirm ? (
              <>
                <Button
                  variant="mono"
                  size="monoSm"
                  disabled={deleting}
                  onClick={() => {
                    setDeleting(true)
                    void deleteCurrentAccount()
                      .then(() => navigate('/', { replace: true }))
                      .finally(() => setDeleting(false))
                  }}
                >
                  {deleting ? <Loader2 className="size-3 animate-spin" /> : 'Permanently delete'}
                </Button>
                <Button variant="monoGhost" size="monoSm" onClick={() => setDeleteConfirm(false)}>
                  Keep account
                </Button>
              </>
            ) : (
              <Button variant="monoMuted" size="monoSm" onClick={() => setDeleteConfirm(true)}>
                <Trash2 className="size-3" /> Delete account
              </Button>
            )}
          </div>
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
