import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'

const PILLARS = [
  {
    n: '01',
    title: 'Search',
    body: 'SHELF-1 searches people’s documents instead of the web. One MD is one URL.',
  },
  {
    n: '02',
    title: 'Branch',
    body: 'It opens only the closest few. If nothing matches, it posts an open call on the spot.',
  },
  {
    n: '03',
    title: 'Settlement',
    body: 'Only the documents it actually opened are billed, over x402. Unopened MDs cost nothing.',
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
            The survey only fires when the shelves come up empty.{' '}
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
              We copied the structure of the internet. One thing is different:
              opening a URL pays its author.
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
