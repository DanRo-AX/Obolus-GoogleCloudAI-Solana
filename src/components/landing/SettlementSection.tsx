import researchFlowImage from '@/assets/product/research-flow-capture-3x.png'
import { useT } from '@/i18n'

/**
 * How an ordinary question becomes a bounded paid research task.
 * The real product screen is kept readable without overpowering the explanation.
 */
export function SettlementSection() {
  const t = useT()
  return (
    <section className="border-t border-border px-4 py-20 sm:px-8 sm:py-28">
      <div className="mx-auto grid max-w-[96rem] grid-cols-1 items-center gap-14 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16 xl:gap-20">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[1.5px] text-muted-foreground">
            {t('Where the money goes')}
          </p>

          <h2 className="mt-5 text-balance font-display text-[32px] leading-[1.1] sm:text-[44px]">
            {t('One bounded USDC balance handles document-level payments.')}
          </h2>

          <p className="mt-6 max-w-xl text-pretty text-[15px] leading-7 text-muted-foreground">
            {t(
              'When an agent needs a private document, the server returns HTTP 402 with its exact USDC price. The agent verifies the recipient and amount, pays from bounded prepaid credit, and opens only the settled document.',
            )}
          </p>

          <div className="mt-9 flex flex-col gap-5">
            {POINTS.map((p) => (
              <div key={p.head} className="flex gap-4 border-t border-border pt-5">
                <span className="mt-1 size-1.5 shrink-0 rounded-full bg-foreground" />
                <div>
                  <p className="text-[15px] font-medium">{t(p.head)}</p>
                  <p className="mt-1 max-w-lg text-pretty text-sm leading-relaxed text-muted-foreground">
                    {t(p.body)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <figure className="w-full min-w-0 max-w-[680px] justify-self-center">
          <div className="overflow-hidden rounded-2xl border border-black/10 bg-[#f4f4f4] shadow-[0_22px_70px_rgba(15,23,42,0.12)]">
            <img
              src={researchFlowImage}
              alt={t(
                'Obulus research flow showing search, ranking, and the choice to commission human evidence',
              )}
              className="block h-auto w-full"
            />
          </div>
          <figcaption className="mt-4 max-w-2xl text-pretty text-sm leading-6 text-muted-foreground">
            {t(
              'A real Obulus question screen. Gemini interprets the request, the Rust core searches and ranks existing evidence, and the user sees a human-research option only when coverage is still missing.',
            )}
          </figcaption>
        </figure>
      </div>
    </section>
  )
}

const POINTS = [
  {
    head: 'You are billed for what was opened, nothing else',
    body: 'A search that finds nothing costs nothing. Only the documents actually quoted appear on the receipt.',
  },
  {
    head: 'One bounded deposit, then document-level settlement',
    body: 'Phantom authorizes only the USDC deposited as prepaid credit. A KMS-protected Pay.sh agent settles each selected document from that bounded balance.',
  },
  {
    head: '90% to evidence owners, 10% to the protocol',
    body: 'The displayed USDC price is complete. The protocol share funds payment, recovery, quality and network operations; settlement moves on Solana.',
  },
  {
    head: 'No SOL required from the buyer',
    body: 'The x402 facilitator sponsors the Devnet network fee. The buyer signs the USDC authorization, not a separate gas transaction.',
  },
]
