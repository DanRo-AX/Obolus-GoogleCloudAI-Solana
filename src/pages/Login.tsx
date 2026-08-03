import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { getBase58Decoder } from '@solana/kit'
import {
  ArrowDown,
  ArrowRight,
  Check,
  Database,
  ExternalLink,
  Loader2,
  Search,
  ShieldCheck,
  Wallet,
  WalletCards,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import Vortex from '@/components/originkit/Vortex'
import { useT } from '@/i18n'
import { createWalletAuthChallenge } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useUi } from '@/state/ui'
import {
  DEVNET_FAUCETS,
  getPhantom,
  PHANTOM_INSTALL_URL,
  shortKey,
  useWallet,
} from '@/state/wallet'

/**
 * Sign in with a wallet, and only with a wallet.
 *
 * Email and social sign-in are gone on purpose. Every account here exists to
 * receive money or to spend it, so an account without a wallet cannot do
 * either — and collecting an email as well would mean holding a thing we
 * promise not to hold. There is no ?mode=signup any more: an address the
 * backend has not seen registers itself on first entry.
 *
 * Entry signs a short, expiring challenge. A public address is not a secret,
 * so deriving a password from it would let anyone impersonate the wallet.
 * The signature proves ownership without approving a transaction or exposing
 * the private key.
 *
 * The 14-and-over confirmation stays visible, because that is a consent and not
 * a credential — a wallet cannot give it on someone's behalf.
 *
 * Split screen: the wallet connect flow on the left, the product flow on the
 * right, so the desktop panel explains what the wallet is being connected to
 * instead of sitting empty. Faucet links sit next to the connect button —
 * a devnet wallet with no SOL and no USDC cannot open anything.
 */
export default function Login() {
  const navigate = useNavigate()
  const t = useT()
  const [params] = useSearchParams()
  // Reset links the backend already sent still land here. Say what happened
  // instead of swallowing the token and bouncing to the dashboard.
  const staleReset =
    params.get('mode') === 'reset' || params.get('mode') === 'forgot'
  const requestedReturn = params.get('returnTo')
  const returnTo =
    requestedReturn?.startsWith('/') &&
    !requestedReturn.startsWith('//') &&
    !requestedReturn.includes('\\')
      ? requestedReturn
      : null
  const { authenticateWallet, account, profile, authReady } = useUi()
  const { available, connecting, pubkey, error: walletError, connect } = useWallet()

  const [ageConfirmed, setAgeConfirmed] = useState(false)
  const [signingIn, setSigningIn] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (staleReset) return
    if (authReady && account)
      navigate(returnTo ?? (profile ? '/dashboard' : '/onboarding'), {
        replace: true,
      })
  }, [account, authReady, navigate, profile, returnTo, staleReset])

  const signIn = async () => {
    if (!pubkey || signingIn) return
    setError(null)
    setSigningIn(true)
    try {
      const provider = getPhantom()
      if (!provider?.signMessage) {
        throw new Error(t('This wallet cannot sign a sign-in message.'))
      }
      const challenge = await createWalletAuthChallenge(pubkey)
      const signed = await provider.signMessage(
        new TextEncoder().encode(challenge.message),
        'utf8',
      )
      const bytes = signed instanceof Uint8Array ? signed : signed.signature
      await authenticateWallet(
        pubkey,
        challenge.id,
        getBase58Decoder().decode(bytes),
        ageConfirmed,
      )
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : t('Could not sign in. Reload the page and connect Phantom again.'),
      )
    } finally {
      setSigningIn(false)
    }
  }

  const busy = connecting || signingIn

  return (
    <div className="grid min-h-svh lg:grid-cols-2">
      <div className="flex flex-col gap-4 p-6 md:p-10">
        <Link to="/" className="flex w-fit items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-[9px] bg-foreground">
            <img
              className="invert"
              src="/OBOLUS-MARK-SM.svg"
              alt=""
              width={20}
              height={20}
            />
          </span>
          <span className="text-[15px] font-semibold tracking-[-0.02em]">
            Obolus
          </span>
        </Link>

        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-[26rem]">
            <p className="font-mono text-[10px] uppercase tracking-[1.5px] text-muted-foreground">
              {t('Sign in')}
            </p>

            {staleReset ? (
              <div className="mt-4 rounded-[4px] border border-border bg-muted-2/60 p-4">
                <p className="text-[13px] leading-relaxed">
                  {t(
                    'That link resets a password, and there are no passwords here any more. Connect the wallet you used before and you are back in — nothing was lost.',
                  )}
                </p>
              </div>
            ) : null}
            <h1 className="mt-3 font-display text-[34px] leading-[1.12]">
              {t('Your wallet is the account')}
            </h1>
            <p className="mt-3 text-[15px] leading-7 text-muted-foreground">
              {t(
                'No password, no email. Money moves wallet to wallet here — connect the one it should move through.',
              )}
            </p>

            {/* step 1 — connect ---------------------------------------- */}
            {pubkey ? (
              <div className="mt-8 flex items-center gap-3 rounded-[4px] border border-[#0F766E]/30 bg-[#0F766E]/[0.06] p-4">
                <Check className="size-4 shrink-0 text-[#0F766E]" />
                <span className="font-mono text-sm">{shortKey(pubkey)}</span>
                <span className="ml-auto font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">
                  {t('connected')}
                </span>
              </div>
            ) : available ? (
              <Button
                variant="mono"
                size="monoLg"
                className="mt-8 w-full"
                disabled={busy}
                onClick={() => void connect()}
              >
                {connecting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Wallet className="size-4" />
                )}
                {connecting ? t('Connecting…') : t('Connect wallet')}
              </Button>
            ) : (
              <div className="mt-8 flex flex-col gap-3">
                <a
                  href={PHANTOM_INSTALL_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-[2px] bg-foreground px-4 text-sm font-medium text-background transition-colors hover:bg-foreground/85"
                >
                  <Wallet className="size-4" />
                  {t('Install Phantom')}
                  <ExternalLink className="size-3.5" />
                </a>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {t(
                    'Phantom is a browser extension. Install it, reload this page, and the button becomes a sign-in.',
                  )}
                </p>
              </div>
            )}

            {/* Faucets belong before the connect, not after it: a fresh
                devnet wallet arrives empty and cannot open a document. */}
            {!pubkey ? (
              <p className="mt-4 text-[13px] leading-relaxed text-muted-foreground">
                {t(
                  'A fresh devnet wallet has no SOL for fees and no USDC to settle with:',
                )}{' '}
                <a
                  href={DEVNET_FAUCETS.sol}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline decoration-dotted underline-offset-4 hover:text-foreground"
                >
                  {t('SOL faucet')}
                </a>
                ,{' '}
                <a
                  href={DEVNET_FAUCETS.usdc}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline decoration-dotted underline-offset-4 hover:text-foreground"
                >
                  {t('USDC faucet')}
                </a>
                .
              </p>
            ) : null}

            {/* step 2 — consent + enter -------------------------------- */}
            {pubkey ? (
              <>
                <button
                  type="button"
                  onClick={() => setAgeConfirmed((v) => !v)}
                  className="mt-4 flex w-full cursor-pointer items-start gap-3 rounded-[4px] border border-border p-3.5 text-left transition-colors hover:bg-foreground/[0.02]"
                >
                  <span
                    className={cn(
                      'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-[2px] border transition-colors',
                      ageConfirmed
                        ? 'border-foreground bg-foreground text-background'
                        : 'border-foreground/25',
                    )}
                  >
                    {ageConfirmed ? <Check className="size-3" /> : null}
                  </span>
                  <span className="text-[13px] leading-relaxed">
                    {t(
                      'I am 14 or over. Required only the first time an address signs in.',
                    )}
                  </span>
                </button>

                <Button
                  variant="mono"
                  size="monoLg"
                  className="mt-3 w-full"
                  disabled={busy}
                  onClick={() => void signIn()}
                >
                  {signingIn ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : null}
                  {signingIn ? t('Signing in…') : t('Enter')}
                  <ArrowRight className="size-3.5" />
                </Button>
              </>
            ) : null}

            {error || walletError ? (
              <p className="mt-4 text-sm text-destructive">
                {t(error ?? walletError ?? '')}
              </p>
            ) : null}

            <div className="mt-10 flex flex-col gap-3 border-t border-border pt-6">
              {ASSURANCES.map((a) => (
                <p
                  key={a}
                  className="flex items-start gap-2.5 text-[13px] leading-relaxed text-muted-foreground"
                >
                  <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-[#0F766E]" />
                  {t(a)}
                </p>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* The desktop panel says what the wallet is being connected to: the
          vortex is the canvas, the three steps are the product. */}
      <aside className="relative hidden overflow-hidden lg:flex lg:flex-col lg:justify-between">
        <div className="absolute inset-0">
          <Vortex background="#08070F" />
        </div>
        {/* The vortex flares widest at the bottom, right where the line sits.
            A shallow scrim buys it contrast without dimming the form. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-1/4 bg-gradient-to-t from-[#08070F] via-[#08070F]/70 to-transparent"
        />

        <div className="relative z-10 p-10 xl:p-14">
          <h2 className="max-w-md font-display text-[30px] leading-[1.12] text-white xl:text-[34px]">
            {t('How one question moves through Obolus')}
          </h2>

          <div className="mt-9 grid max-w-md gap-2">
            <ProductStep
              icon={Search}
              number="01"
              title={t('Ask a question')}
              detail={t('A question goes into the chat box.')}
            />
            <ArrowDown aria-hidden className="ml-6 size-4 text-white/30" />
            <ProductStep
              icon={Database}
              number="02"
              title={t('Search the shelves')}
              detail={t('SHELF opens a handful, not the index')}
            />
            <ArrowDown aria-hidden className="ml-6 size-4 text-white/30" />
            <ProductStep
              icon={WalletCards}
              number="03"
              title={t('Paid citations + receipt')}
              detail={t(
                'Answers come back with the passages they cite, and ₩5 to ₩20 goes to whoever wrote each one.',
              )}
            />
          </div>
        </div>

        <div className="relative z-10 p-10 xl:p-14">
          <div className="flex flex-wrap gap-x-8 gap-y-2 font-mono text-[10px] uppercase tracking-[1.4px] text-white/60">
            <span>
              {t('Settles on')} <span className="text-white/80">Solana</span>
            </span>
            <span>
              {t('Paid in')} <span className="text-white/80">USDC</span>
            </span>
            <span>
              {t('Per open')} <span className="text-white/80">₩5–₩20</span>
            </span>
          </div>
        </div>
      </aside>
    </div>
  )
}

/** One numbered step in the desktop panel. Strings arrive translated. */
function ProductStep({
  icon: Icon,
  number,
  title,
  detail,
}: {
  icon: typeof Search
  number: string
  title: string
  detail: string
}) {
  return (
    <div className="flex items-start gap-4 rounded-[4px] border border-white/10 bg-white/[0.055] p-4 backdrop-blur-sm">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-[3px] bg-white/10">
        <Icon className="size-4 text-white/80" />
      </span>
      <div className="min-w-0">
        <p className="font-mono text-[10px] uppercase tracking-[1.5px] text-[#aa9cf6]">
          {number}
        </p>
        <p className="mt-1 text-[15px] font-medium text-white">{title}</p>
        <p className="mt-1 text-[13px] leading-6 text-white/55">{detail}</p>
      </div>
    </div>
  )
}

const ASSURANCES = [
  'Entering signs one expiring message. It cannot move funds or approve a transaction.',
  'No email, no password, no name — an asker only ever sees your handle.',
  'Payments go wallet to wallet. We never take custody of your balance.',
]
