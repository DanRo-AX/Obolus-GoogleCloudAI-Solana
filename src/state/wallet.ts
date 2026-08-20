import { useCallback, useEffect, useState } from 'react'

/**
 * Phantom, over the injected provider. No wallet-adapter dependency — the flow
 * only ever needs connect, public-key discovery, message signing, and explicit
 * refill transaction signing. The user key never crosses the provider boundary.
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

/** Devnet USDC. The x402 facilitator sponsors fees; buyers only need this test asset. */
export const DEVNET_USDC = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'
export const DEVNET_FAUCETS = {
  usdc: 'https://faucet.circle.com',
}

const X402_GATEWAY_BASE = (
  import.meta.env.PROD
    ? '/x402'
    : (import.meta.env.VITE_X402_GATEWAY_BASE ?? 'http://127.0.0.1:1402')
).replace(/\/$/, '')

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

export type WalletUsdcBalance = {
  amount: string | null
  loading: boolean
  error: string | null
  refreshedAt: number | null
  refresh: () => Promise<void>
}

/**
 * Reads the connected wallet's Devnet USDC balance through the gateway's
 * restricted RPC proxy. This is a public-chain read: no signature, private key,
 * or wallet permission beyond knowing the already-connected public key.
 */
export function useDevnetUsdcBalance(owner: string | null): WalletUsdcBalance {
  const [amount, setAmount] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refreshedAt, setRefreshedAt] = useState<number | null>(null)

  const refresh = useCallback(async () => {
    if (!owner) {
      setAmount(null)
      setError(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`${X402_GATEWAY_BASE}/rpc`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'obulus-wallet-usdc-balance',
          method: 'getTokenAccountsByOwner',
          params: [
            owner,
            { mint: DEVNET_USDC },
            { encoding: 'jsonParsed', commitment: 'confirmed' },
          ],
        }),
      })
      const payload = await response.json() as {
        error?: { message?: string }
        result?: {
          value?: Array<{
            account?: {
              data?: {
                parsed?: {
                  info?: {
                    tokenAmount?: { amount?: string; decimals?: number }
                  }
                }
              }
            }
          }>
        }
      }
      if (!response.ok || payload.error) {
        throw new Error(payload.error?.message ?? `RPC returned ${response.status}`)
      }

      let atomic = 0n
      let decimals = 6
      for (const tokenAccount of payload.result?.value ?? []) {
        const tokenAmount = tokenAccount.account?.data?.parsed?.info?.tokenAmount
        if (!tokenAmount?.amount || !/^\d+$/.test(tokenAmount.amount)) continue
        atomic += BigInt(tokenAmount.amount)
        if (Number.isInteger(tokenAmount.decimals)) decimals = tokenAmount.decimals!
      }
      setAmount(formatTokenAmount(atomic, decimals))
      setRefreshedAt(Date.now())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to read wallet balance')
    } finally {
      setLoading(false)
    }
  }, [owner])

  useEffect(() => {
    if (!owner) {
      setAmount(null)
      setError(null)
      return
    }
    void refresh()
    const onFocus = () => void refresh()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [owner, refresh])

  return { amount, loading, error, refreshedAt, refresh }
}

function formatTokenAmount(atomic: bigint, decimals: number): string {
  const scale = 10n ** BigInt(decimals)
  const whole = atomic / scale
  const fraction = (atomic % scale)
    .toString()
    .padStart(decimals, '0')
    .replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : whole.toString()
}

export function shortKey(k: string) {
  return `${k.slice(0, 4)}…${k.slice(-4)}`
}
