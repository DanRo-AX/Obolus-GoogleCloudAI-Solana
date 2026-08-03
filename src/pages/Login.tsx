import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowDown, Database, Loader2, Search, WalletCards } from 'lucide-react'
import { cn } from '@/lib/utils'
import { forgotPassword, resetPassword } from '@/lib/api'
import { useUi } from '@/state/ui'

/**
 * Split sign-in screen: form on the left, product story on the right.
 * Signup mode is driven by ?mode=signup.
 */
export default function Login() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { authenticate, account, profile, authReady } = useUi()
  const mode = params.get('mode')
  const signup = mode === 'signup'
  const forgot = mode === 'forgot'
  const reset = mode === 'reset'
  const resetToken = params.get('token') ?? ''
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [ageConfirmed, setAgeConfirmed] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  useEffect(() => {
    if (!forgot && !reset && authReady && account) {
      navigate(profile ? '/dashboard' : '/onboarding', { replace: true })
    }
  }, [account, authReady, forgot, navigate, profile, reset])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!reset && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      setError('Enter a valid email address.')
      return
    }
    if (!forgot && password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (signup && !ageConfirmed) {
      setError('Confirm that you are at least 14 years old.')
      return
    }
    setError(null)
    setSuccess(null)
    setSubmitting(true)
    try {
      if (forgot) {
        await forgotPassword(email)
        setSuccess('If that address has an account, a one-hour reset link has been queued.')
      } else if (reset) {
        if (!resetToken) throw new Error('This password reset link is incomplete.')
        await resetPassword(resetToken, password)
        setSuccess('Password changed. You can sign in now.')
      } else {
        await authenticate(email, password, signup, ageConfirmed)
        navigate(signup ? '/onboarding' : '/dashboard', { replace: true })
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Authentication failed.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="grid min-h-svh lg:grid-cols-2">
      <div className="flex flex-col gap-4 p-6 md:p-10">
        <div className="flex flex-1 items-center justify-center">
          <form onSubmit={submit} className="w-full max-w-xs">
            <div className="flex flex-col items-center gap-2 text-center">
              <h1 className="text-2xl font-bold">
                {forgot
                  ? 'Reset your password'
                  : reset
                    ? 'Choose a new password'
                    : signup
                      ? 'Create your account'
                      : 'Sign in'}
              </h1>
              <p className="text-sm text-balance text-muted-foreground">
                {forgot
                  ? 'We will send a one-hour link if the account exists'
                  : reset
                    ? 'All existing sessions will be signed out'
                  : signup
                  ? 'Start free and open a few shelves first'
                  : 'Sign in with your email'}
              </p>
            </div>

            {!reset ? <div className="mt-6 grid gap-3">
              <label htmlFor="email" className="text-sm font-medium">
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="m@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-11 w-full rounded-md border bg-transparent px-3 text-sm outline-none transition-[box-shadow] placeholder:text-muted-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:h-9"
              />
            </div> : null}

            {!forgot ? <div className="mt-4 grid gap-3">
              <div className="flex items-center justify-between">
                <label htmlFor="password" className="text-sm font-medium">
                  Password
                </label>
                <span className="text-xs text-muted-foreground">8–128 characters</span>
              </div>
              <input
                id="password"
                type="password"
                autoComplete={signup ? 'new-password' : 'current-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-11 w-full rounded-md border bg-transparent px-3 text-sm outline-none transition-[box-shadow] focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:h-9"
              />
            </div> : null}

            {signup ? (
              <label className="mt-4 flex cursor-pointer items-start gap-2 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  checked={ageConfirmed}
                  onChange={(event) => setAgeConfirmed(event.target.checked)}
                  className="mt-0.5 size-4"
                />
                <span>I confirm that I am at least 14 years old.</span>
              </label>
            ) : null}

            {error ? (
              <p className="mt-3 text-sm text-destructive">{error}</p>
            ) : null}
            {success ? (
              <p className="mt-3 text-sm text-[#0F766E]">{success}</p>
            ) : null}
            <button
              type="submit"
              disabled={submitting}
              className={cn(
                'mt-5 h-11 w-full cursor-pointer rounded-md bg-primary text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 sm:h-9',
              )}
            >
              {submitting ? (
                <Loader2 className="mx-auto size-4 animate-spin" />
              ) : forgot ? (
                'Send reset link'
              ) : reset ? (
                'Change password'
              ) : signup ? (
                'Sign up'
              ) : (
                'Sign in'
              )}
            </button>

            <p className="mt-5 text-center text-sm">
              {forgot || reset
                ? 'Remembered it? '
                : signup
                  ? 'Already have an account? '
                  : "Don't have an account? "}
              <Link
                to={forgot || reset || signup ? '/login' : '/login?mode=signup'}
                className="underline underline-offset-4"
              >
                {forgot || reset || signup ? 'Sign in' : 'Sign up'}
              </Link>
            </p>
            {!signup && !forgot && !reset ? (
              <p className="mt-2 text-center text-xs text-muted-foreground">
                <Link to="/login?mode=forgot" className="underline underline-offset-4">
                  Forgot password?
                </Link>
              </p>
            ) : null}
          </form>
        </div>
      </div>

      <aside className="relative hidden overflow-hidden bg-[#0a0910] text-white lg:flex lg:flex-col lg:justify-between">
        <div className="absolute inset-0 opacity-50 [background-image:radial-gradient(circle_at_20%_10%,rgba(134,111,242,0.35),transparent_32%),radial-gradient(circle_at_85%_80%,rgba(15,118,110,0.28),transparent_30%)]" />
        <div className="absolute inset-0 opacity-25 [background-image:radial-gradient(rgba(255,255,255,0.8)_0.7px,transparent_0.7px)] [background-size:28px_28px]" />

        <div className="relative z-10 p-10 xl:p-14">
          <div className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-[1.5px] text-white/55">
            <span className="flex size-8 items-center justify-center rounded-[3px] bg-white">
              <img src="/SHELF-SYMBOL.svg" alt="" width={18} height={18} />
            </span>
            Human evidence network
          </div>
          <h2 className="mt-12 max-w-xl font-display text-4xl font-medium leading-tight xl:text-5xl">
            Ask people, not an average persona.
          </h2>
          <p className="mt-5 max-w-lg text-base leading-7 text-white/65">
            OPENSHELF ranks firsthand human databases, opens only the evidence
            a question needs, and settles every paid access with its owner.
          </p>

          <div className="mt-10 grid max-w-xl gap-2">
            <ProductStep
              icon={Search}
              number="01"
              title="Ask a domain-specific question"
              detail="The agent turns intent into explicit audience and evidence requirements."
            />
            <ArrowDown className="ml-6 size-4 text-white/30" />
            <ProductStep
              icon={Database}
              number="02"
              title="Rank trusted human shelves"
              detail="Coverage, relevance, freshness, quality, and provenance decide what opens first."
            />
            <ArrowDown className="ml-6 size-4 text-white/30" />
            <ProductStep
              icon={WalletCards}
              number="03"
              title="Pay only for evidence opened"
              detail="x402 and Pay.sh route Devnet USDC to each database owner with a recoverable ledger."
            />
          </div>
        </div>

        <div className="relative z-10 flex items-center justify-between border-t border-white/10 px-10 py-6 font-mono text-[11px] uppercase tracking-[1.2px] text-white/45 xl:px-14">
          <span>Social world model infrastructure</span>
          <span>Solana · x402 · Pay.sh</span>
        </div>
      </aside>
    </div>
  )
}

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
    <div className="flex items-start gap-4 rounded-[6px] border border-white/10 bg-white/[0.055] p-4 backdrop-blur-sm">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-[3px] bg-white/10">
        <Icon className="size-4 text-white/80" />
      </span>
      <div className="min-w-0">
        <p className="font-mono text-[11px] uppercase tracking-[1px] text-[#aa9cf6]">
          {number}
        </p>
        <p className="mt-1 text-sm font-medium text-white">{title}</p>
        <p className="mt-1 text-xs leading-5 text-white/55">{detail}</p>
      </div>
    </div>
  )
}
