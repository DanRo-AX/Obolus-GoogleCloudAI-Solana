const USDC_ATOMIC = 1_000_000n

export function prepaidTopUpAtomic(value: string | undefined): number {
  const raw = (value ?? '5').trim()
  if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,6})?$/.test(raw)) {
    throw new Error('VITE_PREPAID_TOPUP_USDC must be a decimal with at most six places.')
  }
  const [whole, fraction = ''] = raw.split('.')
  const atomic = BigInt(whole) * USDC_ATOMIC + BigInt(fraction.padEnd(6, '0') || '0')
  if (atomic < 100_000n || atomic > 1_000_000_000n) {
    throw new Error('VITE_PREPAID_TOPUP_USDC must be between 0.1 and 1000 USDC.')
  }
  return Number(atomic)
}

export function krwPerUsdc(value: string | undefined, managed: boolean): number {
  const raw = (value ?? '1350').trim()
  if (!/^[1-9][0-9]*$/.test(raw)) {
    throw new Error('VITE_KRW_PER_USDC must be a positive base-10 integer.')
  }
  const rate = Number(raw)
  if (!Number.isSafeInteger(rate) || rate > 1_000_000_000) {
    throw new Error('VITE_KRW_PER_USDC is outside the supported range.')
  }
  if (managed && rate !== 1_350) {
    throw new Error('Production VITE_KRW_PER_USDC must match the Rust/Pay.sh rate of 1350.')
  }
  return rate
}
