import { Link, NavLink } from 'react-router-dom'
import { LogIn, LogOut, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { NAV_ITEMS } from '@/data/nav'
import { cn } from '@/lib/utils'
import { useUi } from '@/state/ui'

/** Sheet version of the sidebar for viewports below md. */
export function MobileSidebar() {
  const { mobileSidebar, setMobileSidebar, account, profile, signOut } = useUi()

  return (
    <div
      className={cn(
        'fixed inset-0 z-50 md:hidden',
        mobileSidebar ? '' : 'pointer-events-none',
      )}
    >
      <div
        onClick={() => setMobileSidebar(false)}
        className={cn(
          'absolute inset-0 bg-black/40 transition-opacity duration-200',
          mobileSidebar ? 'opacity-100' : 'opacity-0',
        )}
      />
      <div
        className={cn(
          'absolute inset-y-0 left-0 flex w-[16rem] flex-col bg-sidebar transition-transform duration-200 ease-out',
          mobileSidebar ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex flex-col gap-2 p-2">
          <div className="flex min-w-0 flex-1 flex-col gap-1 rounded-lg p-1">
            <Link
              to="/"
              className="flex h-9 w-full items-center gap-2 rounded-sm bg-white p-2.5 text-sm font-medium shadow-lg shadow-black/5"
            >
              <span className="flex size-6 items-center justify-center rounded-[2px] bg-foreground">
                <img
                  className="invert"
                  src="/SHELF-SYMBOL.svg"
                  alt="OPENSHELF"
                  width={14}
                  height={14}
                />
              </span>
              <span className="truncate text-xs font-semibold">OPENSHELF</span>
            </Link>
          </div>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto">
          <div className="relative flex w-full min-w-0 flex-col p-2">
            <ul className="flex w-full min-w-0 flex-col gap-1">
              {NAV_ITEMS.map(({ to, label, Icon, end }) => (
                <li key={to} className="relative">
                  <NavLink
                    to={to}
                    end={end}
                    onClick={() => setMobileSidebar(false)}
                    className={({ isActive }) =>
                      cn(
                        'flex h-8 w-full items-center gap-2 overflow-hidden rounded-md p-2 text-left text-sm font-medium transition-colors hover:bg-sidebar-accent [&>svg]:size-4',
                        isActive && to !== '/' && 'bg-foreground/4',
                      )
                    }
                  >
                    <Icon className="text-muted-foreground/60" />
                    <span>{label}</span>
                  </NavLink>
                </li>
              ))}
              {account?.role === 'admin' ? (
                <li className="relative">
                  <NavLink
                    to="/admin/disputes"
                    onClick={() => setMobileSidebar(false)}
                    className={({ isActive }) =>
                      cn(
                        'flex h-8 w-full items-center gap-2 overflow-hidden rounded-md p-2 text-left text-sm font-medium transition-colors hover:bg-sidebar-accent [&>svg]:size-4',
                        isActive && 'bg-foreground/4',
                      )
                    }
                  >
                    <ShieldCheck className="text-muted-foreground/60" />
                    <span>Review queue</span>
                  </NavLink>
                </li>
              ) : null}
            </ul>
          </div>
        </div>
        <div className="flex flex-col gap-2 p-2 pb-6">
          {account ? (
            <div className="flex gap-2">
              <Button asChild variant="mono" size="mono" className="flex-1">
                <Link to={profile ? '/memory' : '/onboarding'}>
                  {profile?.handle ?? 'Set up profile'}
                </Link>
              </Button>
              <Button
                variant="monoMuted"
                size="mono"
                aria-label="Sign out"
                onClick={() => void signOut()}
              >
                <LogOut className="size-4" />
              </Button>
            </div>
          ) : <div className="flex gap-2">
            <Button
              asChild
              className="font-mono tracking-[1px] uppercase rounded-[2px] bg-foreground/85 text-background border border-foreground/80 hover:bg-foreground/75 h-9 flex-1 px-4 text-xs"
            >
              <Link to="/login?mode=signup">Start free</Link>
            </Button>
            <Button
              asChild
              aria-label="Sign in"
              className="font-mono uppercase rounded-[2px] bg-muted text-foreground hover:bg-muted/90 border border-foreground/5 h-9 w-9 p-0"
            >
              <Link to="/login">
                <LogIn className="size-4" />
              </Link>
            </Button>
          </div>}
          <Button
            asChild
            className="font-mono tracking-[1px] uppercase rounded-[2px] bg-muted text-foreground hover:bg-muted/90 border border-foreground/5 h-9 w-full px-4 text-xs"
          >
            <Link to="/pricing">Pricing</Link>
          </Button>
        </div>
      </div>
    </div>
  )
}
