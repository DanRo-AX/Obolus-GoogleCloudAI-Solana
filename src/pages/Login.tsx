import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { UserRound } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Split sign-in screen: form on the left, point-cloud art on the right.
 * Signup mode is driven by ?mode=signup.
 */
export default function Login() {
  const [params] = useSearchParams()
  const signup = params.get('mode') === 'signup'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = (e: React.FormEvent) => {
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
    setSubmitted(true)
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

            <div className="mt-6 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setSubmitted(true)}
                className="inline-flex h-9 cursor-pointer items-center justify-center gap-2 rounded-md border bg-background text-sm font-medium transition-colors hover:bg-accent"
              >
                <svg className="size-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.7-1.6-2.7-.3-5.5-1.3-5.5-5.9 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0c2.3-1.5 3.3-1.2 3.3-1.2.6 1.7.2 2.9.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .3" />
                </svg>
                GitHub
              </button>
              <button
                type="button"
                onClick={() => setSubmitted(true)}
                className="inline-flex h-9 cursor-pointer items-center justify-center gap-2 rounded-md border bg-background text-sm font-medium transition-colors hover:bg-accent"
              >
                <svg className="size-4" viewBox="0 0 24 24">
                  <path
                    fill="#4285F4"
                    d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8"
                  />
                  <path
                    fill="#34A853"
                    d="M12 24c3.2 0 5.9-1.1 7.9-2.9l-3.9-3c-1 .7-2.4 1.1-4 1.1-3.1 0-5.7-2.1-6.6-4.9H1.4v3.1A12 12 0 0 0 12 24"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.4 14.3a7.2 7.2 0 0 1 0-4.6V6.6H1.4a12 12 0 0 0 0 10.8z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 4.8c1.8 0 3.4.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.4 6.6l4 3.1C6.3 6.9 8.9 4.8 12 4.8"
                  />
                </svg>
                Google
              </button>
            </div>

            <div className="my-6 flex items-center gap-3 text-sm text-muted-foreground">
              <span className="h-px flex-1 bg-border" />
              or
              <span className="h-px flex-1 bg-border" />
            </div>

            <div className="grid gap-3">
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
                <button
                  type="button"
                  className="cursor-pointer text-sm underline-offset-4 hover:underline"
                >
                  Forgot password?
                </button>
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
            {submitted ? (
              <p className="mt-3 rounded-md bg-foreground/5 px-3 py-2 text-sm text-muted-foreground">
                This is a demo build with no auth backend, so the request stops here.
              </p>
            ) : null}

            <button
              type="submit"
              className={cn(
                'mt-5 h-9 w-full cursor-pointer rounded-md bg-primary text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90',
              )}
            >
              {signup ? 'Sign up' : 'Sign in'}
            </button>

            {/* No auth backend in this build, so this is the door that
                actually opens: straight into onboarding. */}
            <Link
              to="/onboarding"
              className="mt-3 flex h-9 w-full cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-foreground/25 font-mono text-xs uppercase tracking-[1px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <UserRound className="size-3.5" />
              Temp sign-in (dev)
            </Link>

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
