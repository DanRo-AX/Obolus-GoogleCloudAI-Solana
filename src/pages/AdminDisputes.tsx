import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { Loader2, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  listDisputes,
  reviewDispute,
  type DisputeCase,
} from '@/lib/api'
import { useUi } from '@/state/ui'

export default function AdminDisputes() {
  const { account, authReady, refreshLedger } = useUi()
  const [cases, setCases] = useState<DisputeCase[]>([])
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [reviewing, setReviewing] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (account?.role !== 'admin') return
    void listDisputes()
      .then(setCases)
      .catch((cause) => setError(cause instanceof Error ? cause.message : 'Could not load disputes.'))
      .finally(() => setLoading(false))
  }, [account?.role])

  if (authReady && account?.role !== 'admin') return <Navigate to="/dashboard" replace />

  const decide = async (
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
      setError(cause instanceof Error ? cause.message : 'Review failed.')
    } finally {
      setReviewing(null)
    }
  }

  return (
    <div className="page-enter flex-1 overflow-y-auto p-4 sm:p-6">
      <div className="mx-auto max-w-4xl">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-4" />
          <h1 className="font-sans text-base font-medium">Dispute review</h1>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          Approval restores the document and releases its original escrow atomically.
          Rejection leaves the strike and payment unchanged.
        </p>
        {error ? <p className="mt-4 text-sm text-destructive">{error}</p> : null}
        {loading ? (
          <Loader2 className="mt-8 size-5 animate-spin text-muted-foreground" />
        ) : (
          <div className="mt-5 grid gap-3">
            {cases.map((item) => (
              <article key={item.memoryId} className="rounded-[6px] border border-border bg-card p-4">
                <div className="flex items-center justify-between gap-3 font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">
                  <span>{item.memoryId}</span>
                  <span>{item.status}</span>
                </div>
                <p className="mt-3 text-sm leading-relaxed">{item.reason}</p>
                {item.status === 'pending' ? (
                  <div className="mt-3 grid gap-2">
                    <textarea
                      rows={2}
                      value={notes[item.memoryId] ?? ''}
                      onChange={(event) =>
                        setNotes((current) => ({ ...current, [item.memoryId]: event.target.value }))
                      }
                      placeholder="Required reviewer rationale"
                      className="w-full resize-y rounded-[3px] border border-border bg-background p-2 text-sm outline-none focus:ring-1 focus:ring-foreground/30"
                    />
                    <div className="flex gap-2">
                      <Button
                        variant="mono"
                        size="monoSm"
                        disabled={reviewing === item.memoryId || (notes[item.memoryId]?.trim().length ?? 0) < 5}
                        onClick={() => void decide(item.memoryId, 'approved')}
                      >
                        Approve and release
                      </Button>
                      <Button
                        variant="monoMuted"
                        size="monoSm"
                        disabled={reviewing === item.memoryId || (notes[item.memoryId]?.trim().length ?? 0) < 5}
                        onClick={() => void decide(item.memoryId, 'rejected')}
                      >
                        Reject
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-muted-foreground">{item.reviewNote}</p>
                )}
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
