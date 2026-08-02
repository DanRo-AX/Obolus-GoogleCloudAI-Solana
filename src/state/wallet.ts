import { useCallback, useEffect, useState } from 'react'

/**
 * Phantom, over the injected provider. No wallet-adapter dependency — the flow
 * only ever needs three things: connect, read the pubkey, and sign one
 * transaction. Anything heavier is weight the demo does not use.
 *
 * The visitor's wallet is the transfer *authority*. The fee payer is a separate
 * keypair on the server, because the x402 exact/SVM scheme forbids the fee payer
 * from also being the authority, source, or delegate of the transfer.
 */

export type PhantomProvider = {
  isPhantom?: boolean
  publicKey?: { toString(): string } | null
  isConnected?: boolean
  connect(opts?: { onlyIfTrusted?: boolean }): Promise<{ publicKey: { toString(): string } }>
  disconnect(): Promise<void>
  signTransaction<T>(tx: T): Promise<T>
  signMessage?(
    message: Uint8Array,
    display?: 'utf8' | 'hex',
  ): Promise<{ signature: Uint8Array } | Uint8Array>
  on(event: string, handler: (...args: unknown[]) => void): void
  removeListener?(event: string, handler: (...args: unknown[]) => void): void
}

declare global {
  interface Window {
    phantom?: { solana?: PhantomProvider }
    solana?: PhantomProvider
  }
}

export function getPhantom(): PhantomProvider | null {
  if (typeof window === 'undefined') return null
  const p = window.phantom?.solana ?? window.solana
  return p?.isPhantom ? p : null
}

export const PHANTOM_INSTALL_URL = 'https://phantom.app/download'

/** Devnet USDC. The faucet step hands out SOL for fees and this mint for value. */
export const DEVNET_USDC = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'
export const DEVNET_FAUCETS = {
  sol: 'https://faucet.solana.com',
  usdc: 'https://faucet.circle.com',
}

export type WalletState = {
  available: boolean
  connecting: boolean
  pubkey: string | null
  error: string | null
  network: 'devnet'
}

export function useWallet() {
  const [state, setState] = useState<WalletState>({
    available: false,
    connecting: false,
    pubkey: null,
    error: null,
    network: 'devnet',
  })

  useEffect(() => {
    const p = getPhantom()
    if (!p) return
    setState((s) => ({ ...s, available: true }))

    // Silent reconnect for a visitor who already approved this origin.
    void p
      .connect({ onlyIfTrusted: true })
      .then((res) => setState((s) => ({ ...s, pubkey: res.publicKey.toString() })))
      .catch(() => {
        /* not previously trusted — wait for an explicit click */
      })

    const onDisconnect = () => setState((s) => ({ ...s, pubkey: null }))
    const onAccountChanged = (...args: unknown[]) => {
      const key = args[0] as { toString(): string } | null
      setState((s) => ({ ...s, pubkey: key ? key.toString() : null }))
    }
    p.on('disconnect', onDisconnect)
    p.on('accountChanged', onAccountChanged)
    return () => {
      p.removeListener?.('disconnect', onDisconnect)
      p.removeListener?.('accountChanged', onAccountChanged)
    }
  }, [])

  const connect = useCallback(async () => {
    const p = getPhantom()
    if (!p) {
      window.open(PHANTOM_INSTALL_URL, '_blank', 'noopener')
      return null
    }
    setState((s) => ({ ...s, connecting: true, error: null }))
    try {
      const res = await p.connect()
      const pubkey = res.publicKey.toString()
      setState((s) => ({ ...s, connecting: false, pubkey }))
      return pubkey
    } catch (e) {
      setState((s) => ({
        ...s,
        connecting: false,
        error: e instanceof Error ? e.message : 'Connection rejected',
      }))
      return null
    }
  }, [])

  const disconnect = useCallback(async () => {
    await getPhantom()?.disconnect()
    setState((s) => ({ ...s, pubkey: null }))
  }, [])

  return { ...state, connect, disconnect }
}

export function shortKey(k: string) {
  return `${k.slice(0, 4)}…${k.slice(-4)}`
}
