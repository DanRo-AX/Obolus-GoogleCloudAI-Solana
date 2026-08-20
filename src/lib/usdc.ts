/**
 * USDC display helpers. The ledger is USDC now: DTOs carry `*_atomic` fields
 * (6-decimal USDC, serialized as JSON strings) that we render everywhere the
 * UI used to print ₩. `formatUsdc` is the exact 6-decimal form the transaction
 * ledger already relied on; `formatUsdcShort` trims trailing zeros for headline
 * figures. When only a legacy KRW value survives, `krwToUsdcAtomic` converts it
 * at the pinned rate (₩1350 = 1 USDC) so nothing user-facing stays in ₩.
 */

export const USDC_DECIMALS = 1_000_000

/** Pinned KRW↔USDC rate, matching the Rust/Pay.sh `krw_to_atomic_pinned`. */
export const KRW_PER_USDC = 1350

/** Exact six-decimal USDC string, or null when the atomic value is unparseable. */
export function formatUsdc(atomic: string | number | bigint): string | null {
  const n = Number(atomic)
  if (!Number.isFinite(n)) return null
  return (n / USDC_DECIMALS).toFixed(6)
}

/**
 * Trimmed USDC string for headline stats: strips trailing zeros but keeps at
 * least two decimals (so "12" reads as "12.00" and "0.0037" stays exact).
 */
export function formatUsdcShort(atomic: string | number | bigint): string | null {
  const n = Number(atomic)
  if (!Number.isFinite(n)) return null
  const whole = (n / USDC_DECIMALS).toFixed(6).replace(/0+$/, '').replace(/\.$/, '')
  if (!whole.includes('.')) return `${whole}.00`
  const [int, frac] = whole.split('.')
  return frac.length === 1 ? `${int}.${frac}0` : whole
}

/** Fixed-rate fallback: convert a legacy KRW integer to a USDC atomic string. */
export function krwToUsdcAtomic(krw: number): string {
  if (!Number.isFinite(krw) || krw <= 0) return '0'
  return String(Math.round((krw / KRW_PER_USDC) * USDC_DECIMALS))
}

/** Convenience: trimmed USDC display from a legacy KRW value. */
export function formatUsdcFromKrw(krw: number): string {
  return formatUsdcShort(krwToUsdcAtomic(krw)) ?? '0.00'
}
