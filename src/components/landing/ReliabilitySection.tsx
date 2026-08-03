import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'

const PILLARS = [
  {
    n: '01',
    title: 'Discover',
    body: 'SHELF-1 searches payment-safe metadata. Private passages remain closed until their exact quote is settled.',
  },
  {
    n: '02',
    title: 'Rank',
    body: 'Relevance, freshness, trust, and query-specific PageRank select a small, diverse set instead of opening every DB.',
  },
  {
    n: '03',
    title: 'Settlement',
    body: 'Prepaid credit is reserved atomically, then the KMS agent pays each selected DB through Pay.sh. Failed opens are restored.',
  },
]

/** The three moves, on a plain card. */
export function ReliabilitySection() {
  return (
    <section className="px-4 sm:px-6">
      <div className="w-full">
        <h2 className="max-w-4xl font-sans text-2xl font-[450] sm:text-3xl">
          <span className="text-foreground">Search comes first. </span>
          <span className="text-muted-foreground">
            AI covers the general floor; the human gap becomes an open call.{' '}
          </span>
          <span className="text-foreground">
            Nobody feels like they are commissioning research. They are just
            searching.
          </span>
        </h2>

        <div className="mt-12 overflow-hidden rounded-lg border bg-card p-6 sm:p-10">
          <div className="flex flex-col gap-4">
            <span className="font-mono text-sm font-semibold uppercase tracking-[2px] text-foreground/80">
              SHELF-1
            </span>
            <h3 className="max-w-xl font-sans text-xl font-[450] leading-snug text-foreground sm:text-2xl">
              One persona DB behaves like one website: discoverable metadata,
              ranked authority, a paid boundary, and an accountable owner.
            </h3>
          </div>

          <ul className="mt-10 grid gap-8 border-t border-border pt-8 sm:grid-cols-3">
            {PILLARS.map((p) => (
              <li key={p.title} className="flex flex-col gap-2">
                <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                  {p.n}
                </span>
                <span className="font-mono text-sm font-semibold uppercase tracking-wider text-foreground">
                  {p.title}
                </span>
                <span className="text-[15px] leading-relaxed text-muted-foreground">
                  {p.body}
                </span>
              </li>
            ))}
          </ul>

          <div className="mt-10">
            <Button asChild variant="monoMuted" size="mono">
              <Link to="/whitepaper">Read the whitepaper</Link>
            </Button>
          </div>
        </div>
      </div>
    </section>
  )
}
