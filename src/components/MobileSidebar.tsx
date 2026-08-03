import { Link, NavLink } from 'react-router-dom'
import { LogIn, LogOut, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { NAV_ITEMS } from '@/data/nav'
import { cn } from '@/lib/utils'
import { useT } from '@/i18n'
import { useUi } from '@/state/ui'

/** Sheet version of the sidebar for viewports below md. */
export function MobileSidebar() {
  const { mobileSidebar, setMobileSidebar, account, profile, signOut } = useUi()
  const t = useT()

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
              className="flex h-11 w-full items-center gap-2 rounded-sm bg-white p-2.5 text-sm font-medium shadow-lg shadow-black/5"
            >
              <span className="flex size-6 items-center justify-center rounded-[7px] bg-foreground">
                <img
                  className="invert"
                  src="/OBOLUS-MARK-SM.svg"
                  alt="Obolus"
                  width={14}
                  height={14}
                />
              </span>
              <span className="truncate text-xs font-semibold">Obolus</span>
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
                        'flex h-11 w-full items-center gap-2 overflow-hidden rounded-md p-2 text-left text-sm font-medium transition-colors hover:bg-sidebar-accent [&>svg]:size-4',
                        isActive && to !== '/' && 'bg-foreground/4',
                      )
                    }
                  >
                    <Icon className="text-muted-foreground/60" />
                    <span>{t(label)}</span>
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
                        'flex h-11 w-full items-center gap-2 overflow-hidden rounded-md p-2 text-left text-sm font-medium transition-colors hover:bg-sidebar-accent [&>svg]:size-4',
                        isActive && 'bg-foreground/4',
                      )
                    }
                  >
                    <ShieldCheck className="text-muted-foreground/60" />
                    <span>{t('Disputes')}</span>
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
                  {profile?.handle ?? t('Set up your shelf')}
                </Link>
              </Button>
              <Button
                variant="monoMuted"
                size="mono"
                aria-label={t('Disconnect Phantom')}
                onClick={() => void signOut()}
              >
                <LogOut className="size-4" />
              </Button>
            </div>
          ) : <div className="flex gap-2">
            <Button
              asChild
              className="h-11 flex-1 rounded-[2px] border border-foreground/80 bg-foreground/85 px-4 text-xs text-background hover:bg-foreground/75"
            >
              <Link to="/login">{t('Connect wallet')}</Link>
            </Button>
            <Button
              asChild
              aria-label={t('Connect a Phantom wallet you already have')}
              className="size-11 rounded-[2px] border border-foreground/5 bg-muted p-0 font-mono uppercase text-foreground hover:bg-muted/90"
            >
              <Link to="/login">
                <LogIn className="size-4" />
              </Link>
            </Button>
          </div>}
        </div>
      </div>
    </div>
  )
}
