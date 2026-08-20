import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { Flag, Loader2, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  listDisputes,
  listDocumentFeedback,
  reviewDispute,
  reviewDocumentFeedback,
  type DisputeCase,
  type DocumentFeedback,
} from '@/lib/api'
import { useUi } from '@/state/ui'
import { shortKey } from '@/state/wallet'
import { useT } from '@/i18n'
import { AuthUnavailable } from '@/components/AuthUnavailable'

export default function AdminDisputes() {
  const t = useT()
  const { account, authReady, authError, retryAuth, refreshLedger } = useUi()
  const [cases, setCases] = useState<DisputeCase[]>([])
  const [feedback, setFeedback] = useState<DocumentFeedback[]>([])
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [reviewing, setReviewing] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!account) return
    void Promise.all([listDisputes(), listDocumentFeedback()])
      .then(([disputes, reports]) => {
        setCases(disputes)
        setFeedback(reports)
      })
      .catch((cause) =>
        setError(
          cause instanceof Error
            ? cause.message
            : t('Could not load the review queue.'),
        ),
      )
      .finally(() => setLoading(false))
  }, [account, t])

  if (authReady && authError && !account) {
    return <AuthUnavailable message={authError} onRetry={retryAuth} />
  }
  if (authReady && !account) {
    return <Navigate to="/login" replace />
  }

  const decideDispute = async (
    memoryId: string,
    decision: 'approved' | 'rejected',
  ) => {
    const note = notes[memoryId]?.trim() ?? ''
    if (note.length < 5) return
    setReviewing(memoryId)
    setError(null)
    try {
      const reviewed = await reviewDispute(memoryId, decision, note)
      setCases((current) =>
        current.map((item) => (item.memoryId === memoryId ? reviewed : item)),
      )
      void refreshLedger().catch(() => undefined)
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : t('Dispute review failed.'),
      )
    } finally {
      setReviewing(null)
    }
  }

  const decideReport = async (
    feedbackId: string,
    decision: 'upheld' | 'dismissed',
  ) => {
    const note = notes[feedbackId]?.trim() ?? ''
    if (note.length < 5) return
    setReviewing(feedbackId)
    setError(null)
    try {
      const reviewed = await reviewDocumentFeedback(feedbackId, decision, note)
      setFeedback((current) =>
        current.map((item) => (item.id === feedbackId ? reviewed : item)),
      )
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : t('Report review failed.'),
      )
    } finally {
      setReviewing(null)
    }
  }

  return (
    <div className="page-enter flex-1 overflow-y-auto p-4 sm:p-6">
      <div className="mx-auto max-w-4xl space-y-8">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-4" />
            <h1 className="font-sans text-base font-medium">
              {t('Admin review queue')}
            </h1>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Answer disputes can restore escrow. Paid-buyer reports can reduce a
            document’s reliability and two upheld reports lock it from search.
          </p>
        </div>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {loading ? (
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        ) : (
          <>
            <ReviewSection
              icon={<Flag className="size-3.5" />}
              title="Paid-document reports"
              count={feedback.filter((item) => item.status === 'pending').length}
              empty="No paid-buyer feedback yet."
              hasItems={feedback.length > 0}
            >
              {feedback.map((item) => (
                <article
                  key={item.id}
                  className="rounded-[6px] border border-border bg-card p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">
                    <span>{item.documentHandle} · payer {shortKey(item.payer)}</span>
                    <span>{item.outcome.replace('_', ' ')} · {item.status}</span>
                  </div>
                  <p className="mt-2 font-mono text-[10px] text-muted-foreground">
                    Query {item.queryId} · {new Date(item.createdAt).toLocaleString()}
                  </p>
                  {item.reason ? (
                    <p className="mt-3 text-sm leading-relaxed">{item.reason}</p>
                  ) : null}
                  {item.outcome === 'report' && item.status === 'pending' ? (
                    <ReviewControls
                      id={item.id}
                      note={notes[item.id] ?? ''}
                      reviewing={reviewing === item.id}
                      primary="Uphold and apply"
                      secondary="Dismiss"
                      onNote={(note) =>
                        setNotes((current) => ({ ...current, [item.id]: note }))
                      }
                      onPrimary={() => void decideReport(item.id, 'upheld')}
                      onSecondary={() => void decideReport(item.id, 'dismissed')}
                    />
                  ) : item.reviewNote ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Reviewer: {item.reviewNote}
                    </p>
                  ) : null}
                </article>
              ))}
            </ReviewSection>

            <ReviewSection
              icon={<ShieldCheck className="size-3.5" />}
              title="Answer disputes"
              count={cases.filter((item) => item.status === 'pending').length}
              empty="No answer disputes yet."
              hasItems={cases.length > 0}
            >
              {cases.map((item) => (
                <article
                  key={item.memoryId}
                  className="rounded-[6px] border border-border bg-card p-4"
                >
                  <div className="flex items-center justify-between gap-3 font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">
                    <span>{item.memoryId}</span>
                    <span>{item.status}</span>
                  </div>
                  <p className="mt-3 text-sm leading-relaxed">{item.reason}</p>
                  {item.status === 'pending' ? (
                    <ReviewControls
                      id={item.memoryId}
                      note={notes[item.memoryId] ?? ''}
                      reviewing={reviewing === item.memoryId}
                      primary="Approve and release"
                      secondary="Reject"
                      onNote={(note) =>
                        setNotes((current) => ({
                          ...current,
                          [item.memoryId]: note,
                        }))
                      }
                      onPrimary={() => void decideDispute(item.memoryId, 'approved')}
                      onSecondary={() => void decideDispute(item.memoryId, 'rejected')}
                    />
                  ) : (
                    <p className="mt-2 text-xs text-muted-foreground">
                      {item.reviewNote}
                    </p>
                  )}
                </article>
              ))}
            </ReviewSection>
          </>
        )}
      </div>
    </div>
  )
}

function ReviewSection({
  icon,
  title,
  count,
  empty,
  hasItems,
  children,
}: {
  icon: React.ReactNode
  title: string
  count: number
  empty: string
  hasItems: boolean
  children: React.ReactNode
}) {
  return (
    <section>
      <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">
        {icon} {title} · {count} pending
      </div>
      {hasItems ? (
        <div className="mt-3 grid gap-3">{children}</div>
      ) : (
        <p className="mt-3 rounded-[6px] border border-dashed border-border p-5 text-sm text-muted-foreground">
          {empty}
        </p>
      )}
    </section>
  )
}

function ReviewControls({
  id,
  note,
  reviewing,
  primary,
  secondary,
  onNote,
  onPrimary,
  onSecondary,
}: {
  id: string
  note: string
  reviewing: boolean
  primary: string
  secondary: string
  onNote: (note: string) => void
  onPrimary: () => void
  onSecondary: () => void
}) {
  return (
    <div className="mt-3 grid gap-2">
      <label htmlFor={`review-${id}`} className="sr-only">
        Required reviewer rationale
      </label>
      <textarea
        id={`review-${id}`}
        rows={2}
        maxLength={1000}
        value={note}
        onChange={(event) => onNote(event.target.value)}
        placeholder="Required reviewer rationale (5–1000 characters)"
        className="w-full resize-y rounded-[3px] border border-border bg-background p-2 text-sm outline-none focus:ring-1 focus:ring-foreground/30"
      />
      <div className="flex gap-2">
        <Button
          variant="mono"
          size="monoSm"
          disabled={reviewing || note.trim().length < 5}
          onClick={onPrimary}
        >
          {reviewing ? <Loader2 className="size-3 animate-spin" /> : null}
          {primary}
        </Button>
        <Button
          variant="monoMuted"
          size="monoSm"
          disabled={reviewing || note.trim().length < 5}
          onClick={onSecondary}
        >
          {secondary}
        </Button>
      </div>
    </div>
  )
}
