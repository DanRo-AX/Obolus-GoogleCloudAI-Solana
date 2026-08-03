import { useT } from '@/i18n'

/**
 * How the money actually moves, kept to one screen.
 *
 * The receipt is the argument, so it gets rendered as a receipt — a narrow
 * mono block against a wide statement — rather than described in a paragraph
 * nobody would finish.
 */
export function SettlementSection() {
  const t = useT()
  return (
    <section className="border-t border-border px-4 py-20 sm:px-8 sm:py-28">
      <div className="mx-auto grid max-w-[92rem] grid-cols-1 gap-14 lg:grid-cols-[1.1fr_1fr] lg:gap-20">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[1.5px] text-muted-foreground">
            {t('Where the money goes')}
          </p>

          <h2 className="mt-5 text-balance font-display text-[32px] leading-[1.1] sm:text-[44px]">
            {t('Nobody approves a ₩12 payment.')}
          </h2>

          <p className="mt-6 max-w-xl text-pretty text-[15px] leading-7 text-muted-foreground">
            {t(
              'So nobody is asked to. HTTP has a status code for this: the server answers',
            )}{' '}
            <strong className="font-medium text-foreground">402</strong>{' '}
            {t(
              'with a price, the wallet pays it, the document opens. Machines settle with machines.',
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

        {/* the receipt -------------------------------------------------- */}
        <div className="lg:pt-16">
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
              <span className="font-mono text-[10px] uppercase tracking-[1.5px] text-muted-foreground">
                {t('Settlement receipt')} · {t('example')}
              </span>
              <span className="font-mono text-[10px] uppercase tracking-[1px] text-[#0F766E]">
                {t('Illustration')}
              </span>
            </div>

            <div className="flex flex-col divide-y divide-border/70">
              {LINES.map((l) => (
                <div
                  key={l.handle}
                  className="flex items-baseline justify-between gap-4 px-5 py-3"
                >
                  <span className="font-mono text-[11px] uppercase tracking-[1px] text-muted-foreground">
                    {l.handle}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">
                    {t(l.shelf)}
                  </span>
                  <span className="font-mono text-[12px] tabular-nums">
                    ₩{l.price}
                  </span>
                </div>
              ))}
            </div>

            <div className="flex items-baseline justify-between gap-4 border-t border-border bg-muted-2/60 px-5 py-3.5">
              <span className="font-mono text-[10px] uppercase tracking-[1.5px] text-muted-foreground">
                {t('4 documents opened')}
              </span>
              <span className="font-mono text-[15px] font-medium tabular-nums">
                ₩38
              </span>
            </div>
          </div>

          <p className="mt-4 font-mono text-[10px] uppercase leading-relaxed tracking-[1px] text-muted-foreground">
            {t(
              'Every line is a person. Every amount left your wallet and arrived in theirs — we are not in the middle of it.',
            )}
          </p>
        </div>
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
    head: 'Your wallet pays each author, per open',
    body: 'The transfer goes from your wallet to theirs the moment the document opens. Nothing sits with us in between.',
  },
  {
    head: 'Priced in won, settled in USDC',
    body: 'You read ₩ because that is what the people on the shelves think in. USDC is what moves on Solana.',
  },
]

const LINES = [
  { handle: 'PARIS_11', shelf: 'Living in Paris', price: 12 },
  { handle: 'PARIS_18', shelf: 'Living in Paris', price: 9 },
  { handle: 'PARIS_05', shelf: 'Markets & groceries', price: 11 },
  { handle: 'PARIS_20', shelf: 'Eating out', price: 6 },
]
