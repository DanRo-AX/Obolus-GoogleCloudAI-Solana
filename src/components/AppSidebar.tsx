import { NavLink, Link } from 'react-router-dom'
import { LogIn, LogOut, PanelLeft, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/primitives'
import { CATEGORY_BY_ID } from '@/data/categories'
import { NAV_ITEMS } from '@/data/nav'
import { STRIKE_LIMIT } from '@/data/onboarding'
import { cn } from '@/lib/utils'
import { useUi } from '@/state/ui'

const MENU_BUTTON =
  'peer/menu-button flex w-full items-center gap-2 overflow-hidden text-left font-medium outline-hidden transition-[width,height,padding] focus-visible:ring-2 focus-visible:ring-sidebar-ring active:bg-sidebar-accent active:text-sidebar-accent-foreground disabled:pointer-events-none disabled:opacity-50 [&>span:last-child]:truncate [&>svg]:shrink-0'

function WorkspaceMark({ size = 'size-6' }: { size?: string }) {
  return (
    <span
      className={cn(
        size,
        'flex items-center justify-center rounded-[2px] bg-foreground',
      )}
    >
      <img className="invert" src="/SHELF-SYMBOL.svg" alt="OPENSHELF" width={15} height={15} />
    </span>
  )
}

/**
 * Signed-in state. The strike counter sits here on purpose — a three-strike
 * rule you only ever see once, on the way in, is not a rule anybody remembers.
 */
function ProfileChip() {
  const { account, profile, signOut, suspended } = useUi()
  if (!profile) return null
  const cat = CATEGORY_BY_ID[profile.field]
  return (
    <div
      className={cn(
        'rounded-[2px] border p-2.5',
        suspended
          ? 'border-destructive/40 bg-destructive/[0.05]'
          : 'border-border bg-card',
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className="size-2 shrink-0 rounded-[1px]"
          style={{ backgroundColor: cat?.accent }}
        />
        <span className="truncate font-mono text-[11px] tracking-[1px] text-foreground">
          {profile.handle}
        </span>
        <button
          type="button"
          onClick={signOut}
          aria-label="Disconnect Phantom"
          className="ml-auto cursor-pointer text-muted-foreground/60 transition-colors hover:text-foreground"
        >
          <LogOut className="size-3.5" />
        </button>
      </div>
      <div className="mt-2 flex items-center justify-between font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">
        <span className="truncate">
          {suspended ? 'Suspended' : `${profile.speaksTo.length} shelves`}
        </span>
        <span
          className={cn(
            'tabular-nums',
            profile.strikes > 0 && 'text-destructive',
          )}
        >
          strike {profile.strikes} of {STRIKE_LIMIT}
        </span>
      </div>
      <div className="mt-2 border-t border-border/70 pt-2 font-mono text-[9px] leading-relaxed text-muted-foreground">
        <p className="truncate normal-case tracking-normal">Signed in · {account?.email}</p>
        <p className="mt-0.5 truncate uppercase tracking-[0.7px]">
          Wallet · {profile.wallet ? `${profile.wallet.slice(0, 4)}…${profile.wallet.slice(-4)} · ${profile.walletVerified ? 'verified' : 'unverified'}` : 'not connected'}
        </p>
      </div>
    </div>
  )
}

export function AppSidebar() {
  const { collapsed, setCollapsed, profile, account, signOut, balance } = useUi()

  return (
    <div
      className="group peer hidden text-sidebar-foreground md:block"
      data-slot="sidebar"
      data-state={collapsed ? 'collapsed' : 'expanded'}
      data-collapsible={collapsed ? 'offcanvas' : ''}
      data-variant="sidebar"
      data-side="left"
    >
      <div
        data-slot="sidebar-gap"
        className="relative w-(--sidebar-width) bg-transparent transition-[width] duration-200 ease-linear group-data-[collapsible=offcanvas]:w-0"
      />
      <div
        data-slot="sidebar-container"
        className={cn(
          'fixed inset-y-0 z-10 hidden h-svh w-(--sidebar-width) transition-[left,right,width] duration-200 ease-linear md:flex',
          'left-0 group-data-[collapsible=offcanvas]:left-[calc(var(--sidebar-width)*-1)]',
        )}
      >
        <div
          data-slot="sidebar-inner"
          className="flex h-full w-full flex-col bg-sidebar"
        >
          {/* Header — workspace switcher + collapse toggle -------------- */}
          <div data-slot="sidebar-header" className="flex flex-col gap-2 p-2">
            <ul
              data-slot="sidebar-menu"
              className="flex w-full min-w-0 flex-col gap-1"
            >
              <li
                data-slot="sidebar-menu-item"
                className="group/menu-item relative flex items-start gap-1"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-1 rounded-lg p-1">
                  <Link
                    to="/"
                    data-slot="sidebar-menu-button"
                    className={cn(
                      MENU_BUTTON,
                      'text-sm h-9 cursor-pointer rounded-sm bg-white p-2.5 shadow-lg shadow-black/5 hover:bg-white hover:shadow-lg',
                    )}
                  >
                    <div className="flex aspect-square size-6 items-center justify-center">
                      <WorkspaceMark />
                    </div>
                    <span className="truncate text-xs font-semibold">
                      OPENSHELF
                    </span>
                  </Link>
                </div>
                <button
                  type="button"
                  aria-label="Collapse sidebar"
                  onClick={() => setCollapsed(true)}
                  className="mt-2 flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-sm text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-foreground"
                >
                  <PanelLeft className="size-4" />
                </button>
              </li>
            </ul>
          </div>

          {/* Content — primary navigation ------------------------------- */}
          <div
            data-slot="sidebar-content"
            className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto"
          >
            <div
              data-slot="sidebar-group"
              className="relative flex w-full min-w-0 flex-col p-2"
            >
              <ul
                data-slot="sidebar-menu"
                className="flex w-full min-w-0 flex-col gap-1"
              >
              {NAV_ITEMS.map(({ to, label, Icon, end }) => (
                  <li
                    key={to}
                    data-slot="sidebar-menu-item"
                    className="group/menu-item relative"
                  >
                    <NavLink
                      to={to}
                      end={end}
                      data-slot="sidebar-menu-button"
                      className={({ isActive }) =>
                        cn(
                          MENU_BUTTON,
                          'rounded-md p-2 [&>svg]:size-4 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground h-8 text-sm',
                          isActive &&
                            to !== '/' &&
                            'bg-foreground/4 text-sidebar-accent-foreground',
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
                    className={({ isActive }) =>
                      cn(
                        MENU_BUTTON,
                        'h-8 rounded-md p-2 text-sm hover:bg-sidebar-accent [&>svg]:size-4',
                        isActive && 'bg-foreground/4',
                      )
                    }
                  >
                    <ShieldCheck className="text-muted-foreground/60" />
                    <span>Disputes</span>
                  </NavLink>
                </li>
              ) : null}
              </ul>
            </div>
          </div>

          {/* Footer — auth CTAs, agents switch, theme toggle ------------- */}
          <div data-slot="sidebar-footer" className="flex flex-col gap-2 p-2">
            <ul
              data-slot="sidebar-menu"
              className="flex w-full min-w-0 flex-col gap-1"
            >
              <li
                data-slot="sidebar-menu-item"
                className="group/menu-item relative flex flex-col gap-2"
              >
                {profile ? (
                  <ProfileChip />
                ) : account ? (
                  <div className="space-y-2 rounded-[2px] border border-border bg-card p-2.5">
                    <p className="truncate font-mono text-[10px] text-muted-foreground">
                      {account.email}
                    </p>
                    <p className="font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">
                      ₩{(balance?.availableKrw ?? 0).toLocaleString()} sandbox for opens
                    </p>
                    <div className="flex gap-2">
                      <Button asChild variant="mono" size="monoSm" className="flex-1">
                        <Link to="/onboarding">Set up your shelf</Link>
                      </Button>
                      <Button
                        variant="monoMuted"
                        size="monoSm"
                        aria-label="Disconnect Phantom"
                        onClick={() => void signOut()}
                      >
                        <LogOut className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex gap-2">
                      <Button
                        asChild
                        className="rounded-[2px] transition-all duration-300 bg-foreground/85 text-background border border-foreground/80 hover:bg-foreground/75 px-4 py-2 h-9 flex-1 text-xs"
                      >
                        <Link to="/login">Connect Phantom</Link>
                      </Button>
                      <Button
                        asChild
                        aria-label="Connect a Phantom wallet you already have"
                        className="rounded-[2px] transition-all duration-300 bg-muted text-foreground hover:bg-muted/90 border border-foreground/5 h-9 w-9 p-0 text-xs"
                      >
                        <Link to="/login">
                          <LogIn className="size-4" />
                        </Link>
                      </Button>
                    </div>
                  </>
                )}
              </li>
            </ul>
            <div className="-mx-2 -mb-2 flex items-center gap-2 px-3 pb-2.5 pt-1">
              <Switch
                checked={false}
                disabled
                aria-label="Asker-agent payments, not available yet"
              />
              <span className="font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground/70">
                Asker-agent payments · later
              </span>
              {/* The original's theme toggle sits here. This build is light-mode
                  only, so the control is omitted rather than shipped dead. */}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
