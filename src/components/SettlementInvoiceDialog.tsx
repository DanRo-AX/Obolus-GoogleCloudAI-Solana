import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Copy, ExternalLink, ReceiptText, ShieldCheck, X } from 'lucide-react'
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
  mode?: 'direct' | 'bundle_escrow' | 'open_call_escrow' | 'pay_sh_direct' | 'pay_sh_orchestrated'
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
  mode,
}: Props) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const displayAsset = invoice ? assetLabel(invoice.invoice.asset) : 'USDC'
  const hasChainProof = settled && txSigs.length > 0
  const hasProgramProof = hasChainProof && (mode === 'bundle_escrow' || mode === 'open_call_escrow')

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
            className="flex max-h-[94dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-[18px] border border-black/10 bg-[#f8f8f6] text-[#151515] shadow-[0_30px_90px_rgba(0,0,0,0.3)] sm:max-h-[88vh] sm:rounded-[18px]"
          >
            <header className="relative flex items-start justify-between gap-4 px-5 pb-5 pt-6 sm:px-8 sm:pb-6 sm:pt-8">
              <div className="flex min-w-0 items-start gap-4">
                <span className="grid size-11 shrink-0 place-items-center rounded-full bg-black text-white">
                  {hasChainProof ? <ShieldCheck className="size-5" /> : <ReceiptText className="size-5" />}
                </span>
                <div className="min-w-0">
                  <p className="font-mono text-[9px] uppercase tracking-[1.4px] text-black/45">
                    {t('Obulus evidence settlement')}
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <h2 className="text-[22px] font-semibold tracking-[-0.025em]">
                      {settled ? t('Settlement receipt') : t('Settlement invoice')}
                    </h2>
                    <span className="rounded-full bg-black/[0.06] px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.8px] text-black/60">
                      {hasChainProof
                        ? partial
                          ? t('Partially settled on Solana')
                          : t('Verified on Solana')
                        : settled
                          ? t('Chain link unavailable')
                          : t('Awaiting payment')}
                    </span>
                  </div>
                  <p className="mt-2 max-w-xl text-xs leading-5 text-black/55">
                    {t('The signed invoice fixes the documents, recipients, amounts, versions, and consent before any money moves.')}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={t('Close')}
                className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-black/45 transition-colors hover:bg-black/[0.06] hover:text-black"
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
                  <div className="grid border-y border-dashed border-black/20 sm:grid-cols-4 sm:divide-x sm:divide-black/10">
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

                  <div className="px-5 py-4 sm:px-8 sm:py-6">
                    <div className="mb-2 grid grid-cols-[1fr_auto] gap-4 border-b border-black/10 pb-2 font-mono text-[9px] uppercase tracking-[1px] text-black/40">
                      <span>{t('Evidence opened')}</span>
                      <span>{t('Amount')}</span>
                    </div>
                    {invoice.invoice.lineItems.map((item, index) => (
                      <article
                        key={`${item.documentHandle}-${item.documentVersion}`}
                        className="border-b border-black/10 py-4 last:border-b-0"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="font-mono text-[9px] uppercase tracking-[1px] text-black/40">
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
                        <dl className="mt-3 grid gap-x-6 gap-y-2 text-[11px] sm:grid-cols-2">
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

                  <div className="border-t border-dashed border-black/20 bg-white/65 px-5 py-5 sm:px-8 sm:py-6">
                    <div className="mb-5 flex items-start gap-3 rounded-xl bg-black px-4 py-4 text-white">
                      <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-300" />
                      <div>
                        <p className="text-sm font-medium">
                          {hasProgramProof
                            ? t('Smart-contract receipt committed')
                            : hasChainProof
                              ? t('Pay.sh settlement verified')
                              : t('Exact invoice prepared before payment')}
                        </p>
                        <p className="mt-1 text-[11px] leading-5 text-white/55">
                          {hasProgramProof
                            ? t('The invoice hash, query hash, document root, document hashes, versions, recipients, and exact amounts can be reconstructed from the Solana settlement account.')
                            : hasChainProof
                              ? t('The invoice hash was locked in the Obulus audit ledger before Pay.sh sent the exact USDC transfers. Explorer links prove the transfers; the private passages remain off-chain.')
                              : t('No on-chain claim is made yet. The invoice hash locks the exact documents, recipients, and amounts before the payment worker can proceed.')}
                        </p>
                      </div>
                    </div>

                    <div className="grid gap-4 text-xs sm:grid-cols-2">
                      <InvoiceField
                        label={t('Network / asset')}
                        value={`${invoice.invoice.network} · ${displayAsset} · ${short(invoice.invoice.asset, 10, 8)}`}
                      />
                      <InvoiceField
                        label={t('Delivery and refund')}
                        value={t('Only paid snapshots open. Failed or unopened amounts return to the bounded balance.')}
                      />
                      <InvoiceField label={t('Query hash')} value={short(invoice.invoice.queryHash)} title={invoice.invoice.queryHash} />
                      <InvoiceField label={t('Document bundle root')} value={short(invoice.invoice.documentBundleRoot)} title={invoice.invoice.documentBundleRoot} />
                      <InvoiceField label={t('Delivery policy')} value={invoice.invoice.deliveryPolicy} />
                      <InvoiceField label={t('Invoice scheme')} value={invoice.invoice.scheme} />
                      <InvoiceField
                        label={t('Settlement rail')}
                        value={hasProgramProof
                          ? t('Obulus settlement program escrow')
                          : mode === 'pay_sh_orchestrated'
                            ? t('Hosted Pay.sh · exact document transfers')
                            : mode === 'pay_sh_direct'
                              ? t('Local Pay.sh · exact document transfers')
                              : t('Pending route selection')}
                      />
                    </div>
                    <div className="mt-5 rounded-xl border border-black/10 bg-[#f8f8f6] p-4">
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-mono text-[9px] uppercase tracking-[1px] text-black/45">
                          {t('Invoice hash')}
                        </span>
                        <button
                          type="button"
                          onClick={() => void copy('invoice', invoice.invoiceHash)}
                          className="inline-flex cursor-pointer items-center gap-1 font-mono text-[9px] uppercase tracking-[1px] text-black/45 hover:text-black"
                        >
                          {copied === 'invoice' ? <Check className="size-3" /> : <Copy className="size-3" />}
                          {copied === 'invoice' ? t('Copied') : t('Copy')}
                        </button>
                      </div>
                      <code className="mt-2 block break-all font-mono text-[10px] leading-5 text-black/70">
                        {invoice.invoiceHash}
                      </code>
                    </div>

                    {txSigs.length ? (
                      <div className="mt-4 grid gap-2">
                        {txSigs.map((signature, index) => (
                          <a
                            key={signature}
                            href={explorerUrl(signature, network)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center justify-between gap-3 rounded-xl border border-black/10 bg-[#f8f8f6] px-3 py-2.5 font-mono text-[10px] transition-colors hover:border-black/25"
                          >
                            <span>{t('Solana transaction')} {index + 1}: {short(signature, 10, 8)}</span>
                            <ExternalLink className="size-3.5" />
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
    <div className="px-5 py-4">
      <p className="font-mono text-[9px] uppercase tracking-[1px] text-black/40">{label}</p>
      <p className="mt-1 text-base font-medium tabular-nums">{value}</p>
      {detail ? <p className="mt-0.5 font-mono text-[9px] text-black/45">{detail}</p> : null}
    </div>
  )
}

function InvoiceField({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="min-w-0">
      <dt className="font-mono text-[9px] uppercase tracking-[0.8px] text-black/40">{label}</dt>
      <dd className="mt-0.5 break-words text-black/75" title={title}>{value}</dd>
    </div>
  )
}
