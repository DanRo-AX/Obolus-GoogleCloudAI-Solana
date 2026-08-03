import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { forgotPassword, resetPassword } from '@/lib/api'
import { useUi } from '@/state/ui'

/**
 * Split sign-in screen: form on the left, point-cloud art on the right.
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
                className="h-9 w-full rounded-md border bg-transparent px-3 text-sm outline-none transition-[box-shadow] placeholder:text-muted-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
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
                className="h-9 w-full rounded-md border bg-transparent px-3 text-sm outline-none transition-[box-shadow] focus-visible:ring-[3px] focus-visible:ring-ring/50"
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
                'mt-5 h-9 w-full cursor-pointer rounded-md bg-primary text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90',
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

      <div className="relative hidden lg:block">
        <div className="absolute inset-0 bg-[#0e0b16]" />
      </div>
    </div>
  )
}
