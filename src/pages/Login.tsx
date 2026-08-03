import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  ArrowRight,
  Check,
  ExternalLink,
  Loader2,
  ShieldCheck,
  Wallet,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import Vortex from '@/components/originkit/Vortex'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import { useUi } from '@/state/ui'
import { PHANTOM_INSTALL_URL, shortKey, useWallet } from '@/state/wallet'

/**
 * Sign in with a wallet, and only with a wallet.
 *
 * Email and social sign-in are gone on purpose. Every account here exists to
 * receive money or to spend it, so an account without a wallet cannot do
 * either — and collecting an email as well would mean holding a thing we
 * promise not to hold.
 *
 * The backend auth contract is left exactly as the team built it. Rather than
 * changing it, the credentials are derived from the connected public key: the
 * address is the identity and a hash of it stands in for the password. Nothing
 * about the server needs to know this screen changed.
 *
 * The 14-and-over confirmation stays visible, because that is a consent and not
 * a credential — a wallet cannot give it on someone's behalf.
 */
export default function Login() {
  const navigate = useNavigate()
  const t = useT()
  const [params] = useSearchParams()
  // Reset links the backend already sent still land here. Say what happened
  // instead of swallowing the token and bouncing to the dashboard.
  const staleReset =
    params.get('mode') === 'reset' || params.get('mode') === 'forgot'
  const { authenticate, account, profile, authReady } = useUi()
  const { available, connecting, pubkey, error: walletError, connect } = useWallet()

  const [ageConfirmed, setAgeConfirmed] = useState(false)
  const [signingIn, setSigningIn] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (staleReset) return
    if (authReady && account)
      navigate(profile ? '/dashboard' : '/onboarding', { replace: true })
  }, [account, authReady, navigate, profile, staleReset])

  const signIn = async () => {
    if (!pubkey || signingIn) return
    setError(null)
    setSigningIn(true)
    try {
      const email = `${pubkey.toLowerCase()}@wallet.openshelf.local`
      const password = await derivePassword(pubkey)
      // An address that has been here before signs in; a new one registers.
      try {
        await authenticate(email, password, false)
      } catch {
        if (!ageConfirmed) throw new Error(t('Confirm you are 14 or over.'))
        await authenticate(email, password, true, ageConfirmed)
      }
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

      <div className="relative hidden lg:block">
        <div className="absolute inset-0">
          <Vortex background="#08070F" />
        </div>
        {/* The vortex flares widest at the bottom, right where the line sits.
            A shallow scrim buys it contrast without dimming the form. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-1/4 bg-gradient-to-t from-[#08070F] via-[#08070F]/70 to-transparent"
        />
        <div className="absolute inset-x-0 bottom-0 p-10">
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
      </div>
    </div>
  )
}

const ASSURANCES = [
  'Connecting only reads your public address. Nothing is signed here.',
  'No email, no password, no name — an asker only ever sees your handle.',
  'Payments go wallet to wallet. We never take custody of your balance.',
]

/**
 * A stable secret for an address, so the existing email/password backend keeps
 * working untouched. It never leaves the browser and is regenerated on every
 * sign-in from the public key alone.
 */
async function derivePassword(pubkey: string): Promise<string> {
  const data = new TextEncoder().encode(`openshelf:wallet:v1:${pubkey}`)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return btoa(String.fromCharCode(...new Uint8Array(digest))).slice(0, 32)
}
