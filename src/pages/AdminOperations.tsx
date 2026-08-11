import { useCallback, useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import {
  Activity,
  AlertTriangle,
  Database,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Users,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  getAdminOperations,
  type AdminOperationsSnapshot,
  type OperationsStatusCount,
} from '@/lib/api'
import { useT } from '@/i18n'
import { useUi } from '@/state/ui'
import { cn } from '@/lib/utils'
import { AuthUnavailable } from '@/components/AuthUnavailable'

export default function AdminOperations() {
  const t = useT()
  const { account, authReady, authError, retryAuth } = useUi()
  const [snapshot, setSnapshot] = useState<AdminOperationsSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setSnapshot(await getAdminOperations())
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t('Could not load the operations snapshot.'),
      )
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    if (account?.role === 'admin') void load()
  }, [account?.role, load])

  if (authReady && authError && !account) {
    return <AuthUnavailable message={authError} onRetry={retryAuth} />
  }
  if (authReady && account?.role !== 'admin') {
    return <Navigate to="/dashboard" replace />
  }

  const reviewBacklog = snapshot
    ? snapshot.marketplace.pendingDisputes +
      snapshot.marketplace.pendingDocumentReports
    : 0

  return (
    <div className="page-enter flex-1 overflow-y-auto p-4 sm:p-6">
      <div className="mx-auto max-w-6xl space-y-8">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Activity className="size-4" />
              <h1 className="font-sans text-base font-medium">
                {t('Operations console')}
              </h1>
              <span className="rounded-[3px] border border-border bg-card px-2 py-1 font-mono text-[9px] uppercase tracking-[1px] text-muted-foreground">
                {t('Read only')}
              </span>
            </div>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              {t(
                'Marketplace, payment recovery, and payout state as aggregate counts. No wallet, signature, credential, session, or private passage is exposed.',
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild variant="monoMuted" size="monoSm">
              <Link to="/admin/disputes">
                <ShieldCheck className="size-3.5" />
                {t('Review queue')}
              </Link>
            </Button>
            <Button
              variant="mono"
              size="monoSm"
              disabled={loading}
              onClick={() => void load()}
            >
              <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
              {t('Refresh')}
            </Button>
          </div>
        </header>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {loading && !snapshot ? (
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        ) : snapshot ? (
          <>
            <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <MetricCard
                icon={<Database className="size-3.5" />}
                label={t('Human documents')}
                value={snapshot.marketplace.humanDocuments}
              />
              <MetricCard
                icon={<Users className="size-3.5" />}
                label={t('Independent contributors')}
                value={snapshot.marketplace.independentContributors}
              />
              <MetricCard
                icon={<Activity className="size-3.5" />}
                label={t('Open calls')}
                value={snapshot.marketplace.openCalls}
                note={`${snapshot.marketplace.filledCalls} ${t('filled')}`}
              />
              <MetricCard
                icon={<AlertTriangle className="size-3.5" />}
                label={t('Needs attention')}
                value={
                  snapshot.settlements.unresolvedPaymentAttempts + reviewBacklog
                }
                note={`${snapshot.settlements.unresolvedPaymentAttempts} ${t('payment')} · ${reviewBacklog} ${t('review')}`}
                alert={
                  snapshot.settlements.unresolvedPaymentAttempts + reviewBacklog >
                  0
                }
              />
            </section>

            <section className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
              <div className="rounded-[6px] border border-border bg-card p-5">
                <SectionTitle
                  label={t('Human coverage and AI liquidity')}
                  detail={t('AI never counts as priced inventory or authority')}
                />
                <div className="mt-5 grid grid-cols-2 gap-x-5 gap-y-4">
                  <SmallMetric
                    label={t('Human covered queries')}
                    value={snapshot.aiLiquidity.humanCoveredQueries}
                  />
                  <SmallMetric
                    label={t('Hybrid coverage queries')}
                    value={snapshot.aiLiquidity.hybridCoverageQueries}
                  />
                  <SmallMetric
                    label={t('AI-only liquidity queries')}
                    value={snapshot.aiLiquidity.aiLiquidityOnlyQueries}
                  />
                  <SmallMetric
                    label={t('Active baselines')}
                    value={snapshot.aiLiquidity.activeBaselines}
                  />
                  <SmallMetric
                    label={t('Priced AI documents')}
                    value={snapshot.aiLiquidity.pricedAiDocuments}
                    invariant
                  />
                  <SmallMetric
                    label={t('AI authority edges')}
                    value={snapshot.aiLiquidity.aiAuthorityEdges}
                    invariant
                  />
                </div>
              </div>

              <div className="rounded-[6px] border border-border bg-card p-5">
                <SectionTitle
                  label={t('Settlement attention')}
                  detail={t('Durable fences stay visible until reconciliation finishes')}
                />
                <div className="mt-5 rounded-[4px] border border-border bg-background p-4">
                  <div className="flex items-baseline justify-between gap-4">
                    <span className="text-sm font-medium">
                      {t('Unresolved payment attempts')}
                    </span>
                    <span
                      className={cn(
                        'font-mono text-xl tabular-nums',
                        snapshot.settlements.unresolvedPaymentAttempts > 0 &&
                          'text-destructive',
                      )}
                    >
                      {snapshot.settlements.unresolvedPaymentAttempts}
                    </span>
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                    {snapshot.settlements.oldestUnresolvedPaymentAt
                      ? `${t('Oldest unresolved')} · ${formatAge(snapshot.generatedAt - snapshot.settlements.oldestUnresolvedPaymentAt, t)}`
                      : t('No payment attempt is waiting for reconciliation.')}
                  </p>
                </div>
                <p className="mt-4 font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">
                  {t('Snapshot generated')} ·{' '}
                  {new Date(snapshot.generatedAt).toLocaleString()}
                </p>
              </div>
            </section>

            <section>
              <SectionTitle
                label={t('Settlement lanes')}
                detail={t('Counts only; open a trace in the owning service when investigation is needed')}
              />
              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                <StatusLane
                  title={t('Document quotes')}
                  counts={snapshot.settlements.paymentQuotes}
                  empty={t('No document quotes yet.')}
                />
                <StatusLane
                  title={t('Research jobs')}
                  counts={snapshot.settlements.researchJobs}
                  empty={t('No research jobs yet.')}
                />
                <StatusLane
                  title={t('Research payment attempts')}
                  counts={snapshot.settlements.researchPaymentAttempts}
                  empty={t('No research payment attempts yet.')}
                />
                <StatusLane
                  title={t('Direct payment attempts')}
                  counts={snapshot.settlements.directPaymentAttempts}
                  empty={t('No direct payment attempts yet.')}
                />
                <StatusLane
                  title={t('Payout claims')}
                  counts={snapshot.settlements.payoutClaims}
                  empty={t('No payout claims yet.')}
                />
                <div className="rounded-[6px] border border-dashed border-border p-4 text-xs leading-relaxed text-muted-foreground">
                  <p className="font-mono text-[10px] uppercase tracking-[1px]">
                    {t('Privacy boundary')}
                  </p>
                  <p className="mt-3">
                    {t(
                      'This screen intentionally stops at aggregate state. Private evidence and payment credentials remain in their owning systems.',
                    )}
                  </p>
                </div>
              </div>
            </section>
          </>
        ) : null}
      </div>
    </div>
  )
}

function MetricCard({
  icon,
  label,
  value,
  note,
  alert = false,
}: {
  icon: React.ReactNode
  label: string
  value: number
  note?: string
  alert?: boolean
}) {
  return (
    <div
      className={cn(
        'rounded-[6px] border bg-card p-4',
        alert ? 'border-destructive/30' : 'border-border',
      )}
    >
      <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">
        {icon} {label}
      </div>
      <div className="mt-4 flex items-baseline justify-between gap-3">
        <span className="font-mono text-3xl tabular-nums">{value}</span>
        {note ? <span className="text-xs text-muted-foreground">{note}</span> : null}
      </div>
    </div>
  )
}

function SmallMetric({
  label,
  value,
  invariant = false,
}: {
  label: string
  value: number
  invariant?: boolean
}) {
  return (
    <div className="border-t border-border pt-3">
      <p className="text-xs leading-snug text-muted-foreground">{label}</p>
      <p className="mt-1 font-mono text-lg tabular-nums">
        {value}
        {invariant && value === 0 ? (
          <span className="ml-2 text-[9px] uppercase tracking-[1px] text-emerald-700">
            invariant
          </span>
        ) : null}
      </p>
    </div>
  )
}

function SectionTitle({ label, detail }: { label: string; detail: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border pb-3">
      <h2 className="text-sm font-medium">{label}</h2>
      <p className="text-xs text-muted-foreground">{detail}</p>
    </div>
  )
}

function StatusLane({
  title,
  counts,
  empty,
}: {
  title: string
  counts: OperationsStatusCount[]
  empty: string
}) {
  return (
    <article className="rounded-[6px] border border-border bg-card p-4">
      <h3 className="font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">
        {title}
      </h3>
      {counts.length ? (
        <div className="mt-3 divide-y divide-border">
          {counts.map((item) => (
            <div
              key={item.status}
              className="flex items-center justify-between gap-3 py-2 text-sm"
            >
              <span
                className={cn(
                  'font-mono text-[11px]',
                  isAttentionStatus(item.status) && 'text-destructive',
                )}
              >
                {item.status.replaceAll('_', ' ')}
              </span>
              <span className="font-mono tabular-nums">{item.count}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">{empty}</p>
      )}
    </article>
  )
}

function isAttentionStatus(status: string) {
  return [
    'ambiguous',
    'claimed',
    'failed',
    'payment_reconciliation',
    'prepared',
    'retry_blocked',
  ].includes(status)
}

function formatAge(milliseconds: number, t: (value: string) => string) {
  const minutes = Math.max(0, Math.floor(milliseconds / 60_000))
  if (minutes < 60) return `${minutes} ${t('minutes ago')}`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours} ${t('hours ago')}`
  return `${Math.floor(hours / 24)} ${t('days ago')}`
}
