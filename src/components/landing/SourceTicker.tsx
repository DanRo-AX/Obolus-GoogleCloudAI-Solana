import { Link } from 'react-router-dom'
import { Database, Eye, FileLock2, ReceiptText } from 'lucide-react'
import { Button } from '@/components/ui/button'

const LAYERS = [
  {
    Icon: FileLock2,
    label: 'Private memory stream',
    body: 'Observation, interview context, importance, reliability, source IDs, corrections, and reflections remain attached to the contributor account.',
  },
  {
    Icon: Database,
    label: 'Sellable document',
    body: 'A quality-checked firsthand passage becomes a versioned document with a content hash, consent state, price, and verified payout owner.',
  },
  {
    Icon: Eye,
    label: 'Public discovery',
    body: 'Agents can inspect an anonymous handle, category, bands, score components, version, hash, price, and payment URL—but not the passage.',
  },
  {
    Icon: ReceiptText,
    label: 'Paid delivery',
    body: 'A query-bound payment releases only the committed snapshot. The final answer keeps its handle and passage-level citation.',
  },
] as const

export function SourceTicker() {
  return (
    <section className="px-4 sm:px-6">
      <div className="w-full">
        <h2 className="max-w-4xl font-sans text-2xl font-[450] sm:text-3xl">
          <span className="text-foreground">A persona DB can become an asset </span>
          <span className="text-muted-foreground">
            without publishing the whole person.
          </span>
        </h2>
        <p className="mt-4 max-w-3xl text-[15px] leading-7 text-muted-foreground">
          Small-talk and interview turns make the memory richer, but discovery
          exposes only payment-safe metadata. The passage crosses the boundary
          only after its exact quote is settled.
        </p>

        <div className="mt-10 overflow-hidden rounded-lg border bg-[#08070F] p-4 sm:p-6">
          <div className="grid gap-3 lg:grid-cols-4">
            {LAYERS.map(({ Icon, label, body }, index) => (
              <article key={label} className="rounded-[6px] border border-white/12 bg-white/[0.06] p-5 text-white">
                <div className="flex items-center justify-between">
                  <Icon className="size-4 text-white/65" />
                  <span className="font-mono text-[10px] text-white/35">0{index + 1}</span>
                </div>
                <h3 className="mt-6 font-mono text-xs uppercase tracking-[1px]">{label}</h3>
                <p className="mt-3 text-sm leading-6 text-white/60">{body}</p>
              </article>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-[6px] border border-white/12 bg-white/[0.04] px-4 py-3">
            <span className="font-mono text-[10px] uppercase tracking-[1px] text-white/45">
              Locking a passage removes it from retrieval and quoting
            </span>
            <Button asChild variant="mono" size="monoSm" className="bg-white text-[#08070F] hover:bg-white/90">
              <Link to="/memory">Open My Memory</Link>
            </Button>
          </div>
        </div>
      </div>
    </section>
  )
}
