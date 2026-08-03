import { useEffect, useState } from 'react'
import { getBase58Decoder } from '@solana/kit'
import { CheckCircle2, ShieldAlert, Wallet } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DEVNET_FAUCETS,
  PHANTOM_INSTALL_URL,
  getPhantom,
  shortKey,
  useWallet,
} from '@/state/wallet'
import { cn } from '@/lib/utils'
import { useUi } from '@/state/ui'
import { getPrepaidBalance, withdrawPrepaidBalance } from '@/lib/api'

/**
 * Connect a browser wallet for Devnet payment. The public key stays separate
 * from the OPENSHELF account until the user explicitly proves payout ownership
 * by signing the server's one-time challenge.
 */
export function WalletButton({ className }: { className?: string }) {
  const { available, connecting, pubkey, error, connect, disconnect } = useWallet()
  const { account, profile, verifyPayoutWallet } = useUi()
  const [showHint, setShowHint] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [verifyError, setVerifyError] = useState<string | null>(null)
  const [confirmReplace, setConfirmReplace] = useState(false)
  const [prepaidAtomic, setPrepaidAtomic] = useState<string | null>(null)
  const [withdrawing, setWithdrawing] = useState(false)
  const [confirmWithdraw, setConfirmWithdraw] = useState(false)

  const verified = Boolean(
    pubkey && profile?.wallet === pubkey && profile.walletVerified,
  )
  const replacing = Boolean(
    pubkey && profile?.wallet && profile.wallet !== pubkey,
  )

  useEffect(() => {
    if (!showHint || !verified) return
    void getPrepaidBalance()
      .then((balance) => setPrepaidAtomic(balance.availableAtomic))
      .catch(() => setPrepaidAtomic(null))
  }, [showHint, verified])

  const withdrawAll = async () => {
    if (!prepaidAtomic || prepaidAtomic === '0' || withdrawing) return
    if (!confirmWithdraw) {
      setConfirmWithdraw(true)
      return
    }
    setWithdrawing(true)
    setVerifyError(null)
    try {
      await withdrawPrepaidBalance()
      setPrepaidAtomic('0')
      setConfirmWithdraw(false)
    } catch (cause) {
      setVerifyError(cause instanceof Error ? cause.message : 'Withdrawal request failed.')
    } finally {
      setWithdrawing(false)
    }
  }

  const verify = async () => {
    if (!pubkey || !profile || verifying) return
    const provider = getPhantom()
    if (!provider?.signMessage) {
      setVerifyError(
        'This wallet does not expose signMessage. It can still pay, but cannot be used for payouts yet.',
      )
      return
    }
    if (replacing && !confirmReplace) {
      setConfirmReplace(true)
      return
    }
    setVerifying(true)
    setVerifyError(null)
    try {
      await verifyPayoutWallet(pubkey, async (message) => {
        const signed = await provider.signMessage!(
          new TextEncoder().encode(message),
          'utf8',
        )
        const signature = signed instanceof Uint8Array ? signed : signed.signature
        return getBase58Decoder().decode(signature)
      })
      setConfirmReplace(false)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Wallet verification failed.'
      setVerifyError(
        /reject|declin|cancel/i.test(message)
          ? 'Signature request was cancelled. No payout wallet was verified.'
          : message,
      )
    } finally {
      setVerifying(false)
    }
  }

  if (pubkey) {
    return (
      <div className={cn('flex flex-col gap-1.5', className)}>
        <button
          type="button"
          onClick={() => setShowHint((v) => !v)}
          className="flex h-9 w-full cursor-pointer items-center gap-2 rounded-[2px] border border-foreground/10 bg-muted-2 px-3 font-mono text-xs uppercase tracking-[1px] text-foreground transition-colors hover:bg-muted"
        >
          <span className="size-1.5 shrink-0 rounded-full bg-[#0F766E]" />
          Browser wallet · {shortKey(pubkey)}
          <span className="ml-auto text-[10px] text-muted-foreground">Devnet</span>
        </button>

        {showHint ? (
          <div className="flex flex-col gap-1 rounded-[3px] border border-border bg-card p-2.5">
            <span className="font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">
              {account?.email ?? 'Signed out'} · OPENSHELF account
            </span>
            {profile ? (
              <div className="rounded-[3px] bg-foreground/[0.04] p-2 text-xs leading-relaxed text-muted-foreground">
                <span className="flex items-center gap-1.5 text-foreground">
                  {verified ? (
                    <CheckCircle2 className="size-3.5 text-[#0F766E]" />
                  ) : (
                    <ShieldAlert className="size-3.5 text-amber-600" />
                  )}
                  Payout wallet · {verified ? 'verified' : 'not verified'}
                </span>
                {profile.wallet ? (
                  <span className="mt-1 block font-mono text-[10px]">
                    Saved: {shortKey(profile.wallet)}
                  </span>
                ) : null}
              </div>
            ) : null}
            {profile && !verified ? (
              <>
                {confirmReplace ? (
                  <p className="text-xs leading-relaxed text-amber-700">
                    This replaces saved payout wallet {shortKey(profile.wallet!)} and immediately revokes its verified status.
                  </p>
                ) : null}
                <button
                  type="button"
                  disabled={verifying}
                  onClick={() => void verify()}
                  className="self-start font-mono text-[10px] uppercase tracking-[1px] text-foreground underline decoration-dotted underline-offset-4 disabled:opacity-50"
                >
                  {verifying
                    ? 'Waiting for signature…'
                    : confirmReplace
                      ? 'Confirm replacement and sign'
                      : replacing
                        ? 'Replace and verify for payouts'
                        : 'Verify for payouts'}
                </button>
                {confirmReplace ? (
                  <button
                    type="button"
                    onClick={() => setConfirmReplace(false)}
                    className="self-start font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground"
                  >
                    Cancel replacement
                  </button>
                ) : null}
              </>
            ) : null}
            {verified ? (
              <div className="rounded-[3px] bg-foreground/[0.04] p-2 text-xs text-muted-foreground">
                <span className="block font-mono text-[10px] uppercase tracking-[1px]">
                  Prepaid balance
                </span>
                <span className="mt-1 block text-foreground">
                  {prepaidAtomic === null
                    ? 'Loading…'
                    : `${(Number(prepaidAtomic) / 1_000_000).toFixed(6)} Devnet USDC`}
                </span>
                {prepaidAtomic && prepaidAtomic !== '0' ? (
                  <button
                    type="button"
                    disabled={withdrawing}
                    onClick={() => void withdrawAll()}
                    className="mt-2 font-mono text-[10px] uppercase tracking-[1px] text-foreground underline decoration-dotted underline-offset-4 disabled:opacity-50"
                  >
                    {withdrawing
                      ? 'Queueing withdrawal…'
                      : confirmWithdraw
                        ? 'Confirm withdraw all'
                        : 'Withdraw all'}
                  </button>
                ) : null}
              </div>
            ) : null}
            <span className="mt-1 font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">
              Devnet test assets · no monetary value
            </span>
            <a
              href={DEVNET_FAUCETS.sol}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs underline decoration-dotted underline-offset-4 hover:text-foreground"
            >
              SOL faucet — for fees
            </a>
            <a
              href={DEVNET_FAUCETS.usdc}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs underline decoration-dotted underline-offset-4 hover:text-foreground"
            >
              USDC faucet — what you spend
            </a>
            <button
              type="button"
              onClick={() => void disconnect()}
              className="mt-1 self-start font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground hover:text-foreground"
            >
              Disconnect
            </button>
            <details className="mt-1 border-t border-border pt-2 text-xs text-muted-foreground">
              <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-[1px]">
                Wallet troubleshooting
              </summary>
              <ul className="mt-2 list-disc space-y-1 pl-4 leading-relaxed">
                <li>Enable Testnet mode and select Solana Devnet in the wallet.</li>
                <li>“Unknown” USDC is expected; verify the mint shown before payment.</li>
                <li>SOL pays network fees. Devnet USDC pays for documents.</li>
                <li>Chrome profiles have separate OPENSHELF cookies and wallet sessions.</li>
              </ul>
            </details>
          </div>
        ) : null}
        {verifyError ? (
          <span className="px-1 text-[11px] leading-snug text-destructive">
            {verifyError}
          </span>
        ) : null}
      </div>
    )
  }

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Button
        type="button"
        onClick={() => void connect()}
        disabled={connecting}
        variant="monoOutline"
        size="mono"
        className="w-full justify-start gap-2"
      >
        <Wallet className="size-3.5" />
        {connecting
          ? 'Connecting…'
          : available
            ? 'Connect wallet'
            : 'Install Phantom'}
      </Button>
      {error ? (
        <span className="px-1 text-[11px] leading-snug text-destructive">
          {error}
        </span>
      ) : null}
      {!available ? (
        <a
          href={PHANTOM_INSTALL_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="px-1 text-[11px] text-muted-foreground underline decoration-dotted underline-offset-4"
        >
          phantom.app
        </a>
      ) : null}
    </div>
  )
}
