import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Copy, ReceiptText, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n'
import type { SettlementPreviewEnvelope } from '@/lib/api'
import { explorerUrl } from '@/lib/x402'

type Props = {
  invoice?: SettlementPreviewEnvelope | null
  loading?: boolean
  error?: string | null
  settled?: boolean
  partial?: boolean
  txSigs?: string[]
  network?: string
}

function atomicUsdc(value: string): string {
  const atomic = BigInt(value || '0')
  const whole = atomic / 1_000_000n
  const fraction = (atomic % 1_000_000n).toString().padStart(6, '0')
  return `${whole}.${fraction}`
}

function short(value: string, left = 8, right = 6): string {
  if (value.length <= left + right + 1) return value
  return `${value.slice(0, left)}…${value.slice(-right)}`
}

function assetLabel(asset: string): string {
  return asset.toUpperCase() === 'USDC' || asset.length > 20 ? 'USDC' : asset
}

export function SettlementInvoiceDialog({
  invoice,
  loading = false,
  error,
  settled = false,
  partial = false,
  txSigs = [],
  network = 'devnet',
}: Props) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const displayAsset = invoice ? assetLabel(invoice.invoice.asset) : 'USDC'

  useEffect(() => {
    if (!open) return
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [open])

  const copy = async (label: string, value: string) => {
    await navigator.clipboard?.writeText(value)
    setCopied(label)
    window.setTimeout(() => setCopied((current) => (current === label ? null : current)), 1400)
  }

  return (
    <>
      <Button
        type="button"
        variant="monoGhost"
        size="mono"
        onClick={() => setOpen(true)}
        className="gap-2"
      >
        <ReceiptText className="size-3.5" />
        {settled ? t('View receipt') : t('View invoice')}
      </Button>

      {open && typeof document !== 'undefined' ? createPortal(
        <div
          className="fixed inset-0 z-[100] flex items-end justify-center bg-black/55 p-0 backdrop-blur-[2px] sm:items-center sm:p-6"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setOpen(false)
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-label={settled ? t('Settlement receipt') : t('Settlement invoice')}
            className="flex max-h-[92dvh] w-full max-w-4xl flex-col overflow-hidden rounded-t-[10px] border border-border bg-background shadow-2xl sm:max-h-[86vh] sm:rounded-[8px]"
          >
            <header className="flex items-start justify-between gap-4 border-b border-border px-4 py-4 sm:px-6">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-medium">
                    {settled ? t('Settlement receipt') : t('Settlement invoice')}
                  </h2>
                  <span className="rounded-full border border-border px-2 py-0.5 font-mono text-[9px] uppercase tracking-[1px] text-muted-foreground">
                    {settled
                      ? partial
                        ? t('Partially settled')
                        : t('Settled')
                      : t('Before automatic payment')}
                  </span>
                </div>
                <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">
                  {t('This record fixes every document, recipient, amount, version, and consent policy before settlement starts.')}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={t('Close')}
                className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-[3px] text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </header>

            <div className="overflow-y-auto">
              {loading && !invoice ? (
                <div className="px-6 py-16 text-center text-sm text-muted-foreground">
                  {t('Preparing the exact invoice…')}
                </div>
              ) : error && !invoice ? (
                <div className="px-6 py-16 text-center text-sm text-destructive">{error}</div>
              ) : invoice ? (
                <>
                  <div className="grid gap-px border-b border-border bg-border sm:grid-cols-4">
                    <Summary label={t('Documents')} value={invoice.invoice.lineItems.length.toString()} />
                    <Summary
                      label={t('Total')}
                      value={`${atomicUsdc(invoice.invoice.totalAmountAtomic)} ${displayAsset}`}
                    />
                    <Summary
                      label={t('Evidence owners')}
                      value={`${atomicUsdc(invoice.invoice.ownerAmountAtomic)} ${displayAsset}`}
                    />
                    <Summary
                      label={t('Protocol fee')}
                      value={`${atomicUsdc(invoice.invoice.platformFeeAtomic)} ${displayAsset}`}
                    />
                  </div>

                  <div className="space-y-3 px-4 py-4 sm:px-6 sm:py-5">
                    {invoice.invoice.lineItems.map((item, index) => (
                      <article
                        key={`${item.documentHandle}-${item.documentVersion}`}
                        className="rounded-[5px] border border-border bg-card p-3 sm:p-4"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="font-mono text-[9px] uppercase tracking-[1px] text-muted-foreground">
                              {String(index + 1).padStart(2, '0')} · {t('Human evidence document')}
                            </p>
                            <p className="mt-1 text-sm font-medium">{item.documentHandle}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-medium">
                              {atomicUsdc(item.amountAtomic)} {displayAsset}
                            </p>
                          </div>
                        </div>
                        <dl className="mt-3 grid gap-2 border-t border-border/70 pt-3 text-[11px] sm:grid-cols-2">
                          <InvoiceField label={t('Recipient')} value={short(item.recipientWallet)} title={item.recipientWallet} />
                          <InvoiceField label={t('Document hash')} value={short(item.documentHash)} title={item.documentHash} />
                          <InvoiceField label={t('Version')} value={`v${item.documentVersion}`} />
                          <InvoiceField label={t('Consent')} value={item.consentVersion} />
                          <InvoiceField
                            label={t('Owner / protocol')}
                            value={`${atomicUsdc(item.ownerAmountAtomic)} / ${atomicUsdc(item.platformAmountAtomic)} ${displayAsset}`}
                          />
                        </dl>
                      </article>
                    ))}
                  </div>

                  <div className="border-t border-border bg-muted-2/45 px-4 py-4 sm:px-6">
                    <div className="grid gap-3 text-xs sm:grid-cols-2">
                      <InvoiceField
                        label={t('Network / asset')}
                        value={`${invoice.invoice.network} · ${displayAsset} · ${short(invoice.invoice.asset, 10, 8)}`}
                      />
                      <InvoiceField
                        label={t('Delivery and refund')}
                        value={t('Only paid snapshots open. Failed or unopened amounts return to the bounded balance.')}
                      />
                    </div>
                    <div className="mt-4 rounded-[4px] border border-border bg-background p-3">
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-mono text-[9px] uppercase tracking-[1px] text-muted-foreground">
                          {t('Invoice hash')}
                        </span>
                        <button
                          type="button"
                          onClick={() => void copy('invoice', invoice.invoiceHash)}
                          className="inline-flex cursor-pointer items-center gap-1 font-mono text-[9px] uppercase tracking-[1px] text-muted-foreground hover:text-foreground"
                        >
                          {copied === 'invoice' ? <Check className="size-3" /> : <Copy className="size-3" />}
                          {copied === 'invoice' ? t('Copied') : t('Copy')}
                        </button>
                      </div>
                      <code className="mt-2 block break-all font-mono text-[10px] leading-5 text-foreground/75">
                        {invoice.invoiceHash}
                      </code>
                    </div>

                    {txSigs.length ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {txSigs.map((signature, index) => (
                          <a
                            key={signature}
                            href={explorerUrl(signature, network)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-mono text-[10px] underline decoration-dotted underline-offset-4"
                          >
                            {t('Transaction')} {index + 1}: {short(signature, 10, 8)}
                          </a>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </>
              ) : null}
            </div>
          </section>
        </div>,
        document.body,
      ) : null}
    </>
  )
}

function Summary({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="bg-background px-4 py-3 sm:px-5">
      <p className="font-mono text-[9px] uppercase tracking-[1px] text-muted-foreground">{label}</p>
      <p className="mt-1 text-base font-medium tabular-nums">{value}</p>
      {detail ? <p className="mt-0.5 font-mono text-[9px] text-muted-foreground">{detail}</p> : null}
    </div>
  )
}

function InvoiceField({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="min-w-0">
      <dt className="font-mono text-[9px] uppercase tracking-[0.8px] text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words text-foreground/80" title={title}>{value}</dd>
    </div>
  )
}
