/**
 * User-facing marketplace economics.
 *
 * The document price shown to the buyer is the complete price. It is split
 * between the evidence owner and the protocol; the protocol fee is never added
 * as a surprise checkout surcharge. The settlement service must enforce the
 * same basis-point policy in atomic USDC units.
 */
export const PROTOCOL_FEE_BPS = 1_000
export const DATA_OWNER_BPS = 10_000 - PROTOCOL_FEE_BPS

export function protocolFeeBreakdown(totalKrw: number): {
  ownerKrw: number
  protocolKrw: number
} {
  if (!Number.isFinite(totalKrw) || totalKrw < 0) {
    throw new Error('The document total must be a finite, non-negative number.')
  }

  const protocolKrw = (totalKrw * PROTOCOL_FEE_BPS) / 10_000
  return {
    ownerKrw: totalKrw - protocolKrw,
    protocolKrw,
  }
}

export function formatKrwPreview(value: number): string {
  return new Intl.NumberFormat('ko-KR', {
    maximumFractionDigits: 1,
  }).format(value)
}
