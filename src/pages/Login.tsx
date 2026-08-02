import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useUi } from '@/state/ui'

/**
 * Split sign-in screen: form on the left, point-cloud art on the right.
 * Signup mode is driven by ?mode=signup.
 */
export default function Login() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { authenticate, account, profile, authReady } = useUi()
  const signup = params.get('mode') === 'signup'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (authReady && account) navigate(profile ? '/dashboard' : '/onboarding', { replace: true })
  }, [account, authReady, navigate, profile])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      setError('Enter a valid email address.')
      return
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    setError(null)
    setSubmitting(true)
    try {
      await authenticate(email, password, signup)
      navigate(signup ? '/onboarding' : '/dashboard', { replace: true })
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
                {signup ? 'Create your account' : 'Sign in'}
              </h1>
              <p className="text-sm text-balance text-muted-foreground">
                {signup
                  ? 'Start free and open a few shelves first'
                  : 'Sign in with your email'}
              </p>
            </div>

            <div className="mt-6 grid gap-3">
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
            </div>

            <div className="mt-4 grid gap-3">
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
            </div>

            {error ? (
              <p className="mt-3 text-sm text-destructive">{error}</p>
            ) : null}
            <button
              type="submit"
              disabled={submitting}
              className={cn(
                'mt-5 h-9 w-full cursor-pointer rounded-md bg-primary text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90',
              )}
            >
              {submitting ? <Loader2 className="mx-auto size-4 animate-spin" /> : signup ? 'Sign up' : 'Sign in'}
            </button>

            <p className="mt-5 text-center text-sm">
              {signup ? 'Already have an account? ' : "Don't have an account? "}
              <Link
                to={signup ? '/login' : '/login?mode=signup'}
                className="underline underline-offset-4"
              >
                {signup ? 'Sign in' : 'Sign up'}
              </Link>
            </p>
          </form>
        </div>
      </div>

      <div className="relative hidden lg:block">
        <div className="absolute inset-0 bg-[#0e0b16]" />
      </div>
    </div>
  )
}
