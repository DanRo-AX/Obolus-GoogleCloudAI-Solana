import { Link } from 'react-router-dom'
import { Bot, Database, FileCheck2, Search, WalletCards } from 'lucide-react'
import { Button } from '@/components/ui/button'

const STEPS = [
  {
    n: '01',
    Icon: Search,
    title: 'Search without opening',
    body: 'Rust filters by the question and optional demographic bands, then ranks safe metadata. Passage text is not returned.',
  },
  {
    n: '02',
    Icon: Database,
    title: 'Commit the exact DBs',
    body: 'The job freezes each handle, content hash, version, consent version, owner, price, mint, network, and expiry.',
  },
  {
    n: '03',
    Icon: WalletCards,
    title: 'Reserve prepaid credit',
    body: 'The question total is reserved atomically. Phantom appears only for wallet proof or a balance refill.',
  },
  {
    n: '04',
    Icon: Bot,
    title: 'Agent pays each DB',
    body: 'The Cloud Run worker checks every 402 challenge and uses Pay.sh with a GCP KMS signer. Owners are paid independently.',
  },
  {
    n: '05',
    Icon: FileCheck2,
    title: 'Synthesize paid evidence',
    body: 'Only successfully paid immutable snapshots become citations. Lost responses recover from the ledger instead of paying twice.',
  },
] as const

/** The executable request path, replacing fabricated answer comparisons. */
export function TrialSection() {
  return (
    <section className="px-4 sm:px-6">
      <div className="w-full">
        <span className="font-mono text-[10px] uppercase tracking-[1.5px] text-muted-foreground">
          The proof is the boundary
        </span>
        <h2 className="mt-3 max-w-4xl font-sans text-2xl font-[450] text-foreground sm:text-3xl">
          One question becomes a paid, recoverable chain of evidence.
        </h2>
        <p className="mt-4 max-w-3xl text-[15px] leading-7 text-muted-foreground">
          Payment does not make a statement true. It proves which committed human
          passage was opened, who was entitled to payment, and which evidence the
          final answer was allowed to use.
        </p>

        <ol className="mt-10 grid overflow-hidden rounded-[6px] border border-border bg-card lg:grid-cols-5">
          {STEPS.map(({ n, Icon, title, body }) => (
            <li key={n} className="border-b border-border p-5 last:border-0 lg:border-b-0 lg:border-r lg:last:border-r-0">
              <div className="flex items-center justify-between">
                <Icon className="size-4 text-muted-foreground" />
                <span className="font-mono text-[10px] text-muted-foreground">{n}</span>
              </div>
              <h3 className="mt-5 text-sm font-medium">{title}</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{body}</p>
            </li>
          ))}
        </ol>

        <div className="mt-6 flex flex-col gap-4 rounded-[6px] bg-foreground/[0.04] p-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
            If human coverage is thin, Gemini on Vertex AI may return a free,
            expiring general baseline and identify the missing firsthand evidence.
            It never enters Memory, ranking, authority, paid citations, or contributor earnings.
          </p>
          <Button asChild variant="mono" size="mono" className="shrink-0">
            <Link to="/">Run the flow</Link>
          </Button>
        </div>
      </div>
    </section>
  )
}
