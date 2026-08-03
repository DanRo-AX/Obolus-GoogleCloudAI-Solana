import { Link } from 'react-router-dom'
import { Bot, Database, Search, ShieldCheck, Wallet } from 'lucide-react'
import { FaqSection } from '@/components/FaqSection'
import { Button } from '@/components/ui/button'
import { PRICING_FAQ } from '@/data/faq'

const UNITS = [
  {
    Icon: Search,
    title: 'Search and ranking',
    price: '₩0',
    body: 'Candidate handles, prices, demographic bands, and score components are free. Private passages remain closed.',
  },
  {
    Icon: Database,
    title: 'Existing human DB',
    price: 'Per document',
    body: 'The exact KRW price and Devnet USDC amount are committed before purchase. Only DBs the agent successfully opens are billed.',
  },
  {
    Icon: Bot,
    title: 'New human research',
    price: 'Rate × people',
    body: 'When coverage is missing, the asker chooses the answer rate and target count. Unfilled or cancelled slots are refundable.',
  },
] as const

const FLOW = [
  ['1', 'Verify once', 'Phantom signs a fresh ownership message. No private key or token delegate is given to OPENSHELF.'],
  ['2', 'Refill when low', 'Phantom transfers only the chosen Devnet USDC refill. A revocable 30-day session can reserve that prepaid balance and nothing else.'],
  ['3', 'Reserve exactly', 'Rust commits every document, owner, hash, price, mint, and network, then atomically reserves the question total.'],
  ['4', 'Pay each DB', 'A Cloud Run agent uses Pay.sh/MPP and a non-exportable GCP KMS signer to pay each verified DB owner independently.'],
  ['5', 'Return the remainder', 'Paid snapshots become citations. Any permanently unopened amount returns to prepaid credit and can be withdrawn.'],
] as const

export default function Pricing() {
  return (
    <div className="page-enter flex-1 overflow-y-auto">
      <section className="px-5 pb-12 pt-8 sm:px-8 lg:px-12">
        <div className="mx-auto max-w-[76rem]">
          <span className="font-mono text-[10px] uppercase tracking-[1.5px] text-muted-foreground">
            Current Devnet pricing
          </span>
          <h1 className="mt-3 max-w-3xl font-display text-3xl font-medium leading-tight sm:text-4xl">
            Search is free. Human evidence is paid one DB at a time.
          </h1>
          <p className="mt-4 max-w-2xl text-[15px] leading-7 text-muted-foreground">
            OPENSHELF has no active subscription tier or monthly bundle. The live
            unit is one successfully opened human document, or one accepted answer
            to an open call.
          </p>

          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {UNITS.map(({ Icon, title, price, body }) => (
              <article key={title} className="rounded-[6px] border border-border bg-card p-5">
                <Icon className="size-4 text-muted-foreground" />
                <p className="mt-5 font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">
                  {title}
                </p>
                <h2 className="mt-1 font-display text-2xl font-medium">{price}</h2>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">{body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="border-y border-border bg-foreground/[0.025] px-5 py-14 sm:px-8 lg:px-12">
        <div className="mx-auto grid max-w-[76rem] gap-12 lg:grid-cols-[0.8fr_1.2fr]">
          <div>
            <span className="font-mono text-[10px] uppercase tracking-[1.5px] text-muted-foreground">
              Hosted web payment
            </span>
            <h2 className="mt-3 font-display text-2xl font-medium">
              One wallet proof, then bounded automatic settlement
            </h2>
            <p className="mt-4 text-[15px] leading-7 text-muted-foreground">
              The browser controls refills. The server agent controls only the
              prepaid service wallet held behind Google Cloud KMS. Those are two
              different keys and two different authorities.
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-[3px] border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[1px]">
                <Wallet className="size-3" /> Phantom · proof and refill
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-[3px] border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[1px]">
                <ShieldCheck className="size-3" /> KMS · service signing
              </span>
            </div>
          </div>

          <ol className="overflow-hidden rounded-[6px] border border-border bg-card">
            {FLOW.map(([n, title, body]) => (
              <li key={n} className="grid grid-cols-[28px_1fr] gap-3 border-b border-border p-4 last:border-0">
                <span className="font-mono text-xs text-muted-foreground">{n}</span>
                <div>
                  <h3 className="text-sm font-medium">{title}</h3>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">{body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="px-5 py-14 sm:px-8 lg:px-12">
        <div className="mx-auto flex max-w-[76rem] flex-col gap-5 rounded-[6px] border border-border bg-card p-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="max-w-3xl">
            <h2 className="font-sans text-lg font-medium">Devnet boundary</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Current transfers use test USDC on Solana Devnet. Mainnet, fiat
              checkout, subscriptions, and commercial custody are not enabled.
              External agents may use the Antigravity OpenShelf tools with a
              locally protected Pay account instead of the hosted prepaid flow.
            </p>
          </div>
          <Button asChild variant="mono" size="mono" className="shrink-0">
            <Link to="/">Ask a question</Link>
          </Button>
        </div>
      </section>

      <FaqSection items={PRICING_FAQ} className="pb-32 pt-0" />
    </div>
  )
}
