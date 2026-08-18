import { useCallback, useEffect, useState } from 'react'
import { Coins, Loader2, Minus, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Banner } from '@/components/ui/primitives'
import { useT } from '@/i18n'
import { getPrepaidBalance, type PrepaidBalance } from '@/lib/api'
import {
  depositPrepaidAtomic,
  PaymentError,
  PREPAID_DEPOSIT_ENABLED,
  USDC_ATOMIC,
} from '@/lib/x402'
import { cn } from '@/lib/utils'

/** Whole-USDC presets. The stepper below also moves in 1-USDC increments. */
const PRESETS_USDC = [1, 5, 10, 25]
const DEFAULT_USDC = 5
const MIN_USDC = 1
const MAX_USDC = 1000

/** atomic (6dp) USDC string → a trimmed decimal for display. */
function formatUsdc(atomic: string): string {
  const value = Number(atomic) / USDC_ATOMIC
  if (!Number.isFinite(value)) return '0'
  return value.toLocaleString(undefined, { maximumFractionDigits: 6 })
}

/**
 * USDC prepaid top-up — the pot that actually pays authors, shown and refilled
 * in whole-USDC steps. Sits in Memory's answers tab next to the withdraw
 * control. The submit stays disabled until the backend standalone-deposit route
 * ships (PREPAID_DEPOSIT_ENABLED); everything else — balance, picker, the
 * low-balance prompt — is live.
 */
export function PrepaidTopUp({ className }: { className?: string }) {
  const t = useT()
  const [balance, setBalance] = useState<PrepaidBalance | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [usdc, setUsdc] = useState(DEFAULT_USDC)
  const [status, setStatus] = useState<'idle' | 'pending' | 'done'>('idle')
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setLoadError(false)
    try {
      setBalance(await getPrepaidBalance())
    } catch {
      // A missing prepaid session (unverified wallet) is an empty state, not a
      // hard error; both land here and are told apart by whether balance stays
      // null, so the copy stays gentle either way.
      setBalance(null)
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const setAmount = (next: number) => {
    setStatus('idle')
    setError(null)
    setUsdc(Math.min(MAX_USDC, Math.max(MIN_USDC, Math.round(next))))
  }

  const availableAtomic = balance ? Number(balance.availableAtomic) : 0
  const isLow = !!balance && availableAtomic < USDC_ATOMIC

  const submit = async () => {
    if (status === 'pending') return
    setError(null)
    setStatus('pending')
    try {
      await depositPrepaidAtomic(usdc * USDC_ATOMIC)
      setStatus('done')
      await refresh()
    } catch (e) {
      setStatus('idle')
      setError(
        e instanceof PaymentError
          ? e.message
          : e instanceof Error
            ? e.message
            : t('The top-up did not go through.'),
      )
    }
  }

  return (
    <Banner tone="neutral" className={cn('overflow-hidden p-0', className)}>
      <div className="flex flex-col gap-3 px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Coins className="size-3.5" />
            {t('Prepaid USDC')}
          </span>
          {loading ? (
            <Loader2 className="size-3 animate-spin" />
          ) : balance ? (
            <span>
              <strong className="text-foreground">{formatUsdc(balance.availableAtomic)}</strong> USDC{' '}
              {t('available')}
            </span>
          ) : (
            <span>
              {loadError
                ? t('Prepaid balance loads once your wallet is verified.')
                : t('No prepaid balance yet.')}
            </span>
          )}
        </div>

        {isLow ? (
          <p className="text-sm leading-relaxed text-foreground">
            {t('Your prepaid USDC is low. Top up to keep opening documents?')}
          </p>
        ) : (
          <p className="text-sm leading-relaxed text-muted-foreground">
            {t('Add USDC to pay authors as you open documents. Whole-USDC steps.')}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {PRESETS_USDC.map((preset) => (
            <Button
              key={preset}
              variant={usdc === preset ? 'mono' : 'monoOutline'}
              size="monoSm"
              onClick={() => setAmount(preset)}
            >
              {preset} USDC
            </Button>
          ))}

          <div className="ml-auto flex items-center gap-1.5">
            <Button
              variant="monoOutline"
              size="icon"
              className="size-8"
              aria-label={t('Decrease by 1 USDC')}
              disabled={usdc <= MIN_USDC}
              onClick={() => setAmount(usdc - 1)}
            >
              <Minus className="size-3.5" />
            </Button>
            <span className="min-w-[4.5rem] text-center font-mono text-sm tabular-nums text-foreground">
              {usdc} USDC
            </span>
            <Button
              variant="monoOutline"
              size="icon"
              className="size-8"
              aria-label={t('Increase by 1 USDC')}
              disabled={usdc >= MAX_USDC}
              onClick={() => setAmount(usdc + 1)}
            >
              <Plus className="size-3.5" />
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <Button
            variant="mono"
            size="monoSm"
            disabled={!PREPAID_DEPOSIT_ENABLED || status === 'pending'}
            onClick={() => void submit()}
          >
            {status === 'pending' ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                {t('Topping up…')}
              </>
            ) : (
              `${t('Top up')} · ${usdc} USDC`
            )}
          </Button>

          {!PREPAID_DEPOSIT_ENABLED ? (
            <span className="font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">
              {t('Backend deposit route pending')}
            </span>
          ) : null}
          {status === 'done' ? (
            <span className="text-sm text-foreground">{t('Topped up. Balance updated.')}</span>
          ) : null}
        </div>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </div>
    </Banner>
  )
}
