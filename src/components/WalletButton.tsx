import { useEffect, useState } from 'react'
import { Wallet } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DEVNET_FAUCETS,
  PHANTOM_INSTALL_URL,
  shortKey,
  useWallet,
} from '@/state/wallet'
import { cn } from '@/lib/utils'
import { useUi, type Profile } from '@/state/ui'

function withWallet(profile: Profile, wallet: string) {
  return {
    handle: profile.handle,
    ageBand: profile.ageBand,
    region: profile.region,
    household: profile.household,
    field: profile.field,
    years: profile.years,
    speaksTo: profile.speaksTo,
    wallet,
  }
}

/**
 * Step 2 of the flow: connect Phantom on devnet. Only the pubkey is shared —
 * nothing is signed here. The first-run faucet hint appears alongside, because
 * a fresh devnet wallet has neither the SOL for fees nor the USDC to spend.
 */
export function WalletButton({ className }: { className?: string }) {
  const { available, connecting, pubkey, error, connect, disconnect } = useWallet()
  const { profile, saveProfile } = useUi()
  const [showHint, setShowHint] = useState(false)
  const [walletSaveError, setWalletSaveError] = useState<string | null>(null)

  useEffect(() => {
    if (!pubkey || !profile || profile.wallet === pubkey) return
    void saveProfile(withWallet(profile, pubkey)).catch((saveError) => {
      setWalletSaveError(
        saveError instanceof Error ? saveError.message : 'Wallet could not be saved.',
      )
    })
  }, [profile, pubkey, saveProfile])

  if (pubkey) {
    return (
      <div className={cn('flex flex-col gap-1.5', className)}>
        <button
          type="button"
          onClick={() => setShowHint((v) => !v)}
          className="flex h-9 w-full cursor-pointer items-center gap-2 rounded-[2px] border border-foreground/10 bg-muted-2 px-3 font-mono text-xs uppercase tracking-[1px] text-foreground transition-colors hover:bg-muted"
        >
          <span className="size-1.5 shrink-0 rounded-full bg-[#0F766E]" />
          {shortKey(pubkey)}
          <span className="ml-auto text-[10px] text-muted-foreground">devnet</span>
        </button>

        {showHint ? (
          <div className="flex flex-col gap-1 rounded-[3px] border border-border bg-card p-2.5">
            <span className="font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">
              Top up devnet
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
          </div>
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
      {error || walletSaveError ? (
        <span className="px-1 text-[11px] leading-snug text-destructive">
          {error ?? walletSaveError}
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
