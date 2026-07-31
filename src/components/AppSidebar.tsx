import { NavLink, Link } from 'react-router-dom'
import { LogIn, LogOut, PanelLeft, UserRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/primitives'
import { WalletButton } from '@/components/WalletButton'
import { CATEGORY_BY_ID } from '@/data/categories'
import { NAV_ITEMS } from '@/data/nav'
import { STRIKE_LIMIT } from '@/data/onboarding'
import { cn, maskStyle } from '@/lib/utils'
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
  const { profile, signOut } = useUi()
  if (!profile) return null
  const cat = CATEGORY_BY_ID[profile.field]
  return (
    <div className="rounded-[2px] border border-border bg-card p-2.5">
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
          aria-label="Sign out"
          className="ml-auto cursor-pointer text-muted-foreground/60 transition-colors hover:text-foreground"
        >
          <LogOut className="size-3.5" />
        </button>
      </div>
      <div className="mt-2 flex items-center justify-between font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">
        <span className="truncate">{profile.speaksTo.length} fields</span>
        <span
          className={cn(
            'tabular-nums',
            profile.strikes > 0 && 'text-destructive',
          )}
        >
          {profile.strikes}/{STRIKE_LIMIT} strikes
        </span>
      </div>
    </div>
  )
}

export function AppSidebar() {
  const { collapsed, setCollapsed, agents, setAgents, profile } = useUi()

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
                ) : (
                  <>
                    <div className="flex gap-2">
                      <Button
                        asChild
                        className="font-mono tracking-[1px] uppercase rounded-[2px] transition-all duration-300 bg-foreground/85 text-background border border-foreground/80 hover:bg-foreground/75 px-4 py-2 h-9 flex-1 text-xs"
                      >
                        <Link to="/login?mode=signup">Start free</Link>
                      </Button>
                      <Button
                        asChild
                        aria-label="Sign in"
                        className="font-mono tracking-[1px] uppercase rounded-[2px] transition-all duration-300 bg-muted text-foreground hover:bg-muted/90 border border-foreground/5 h-9 w-9 p-0 text-xs"
                      >
                        <Link to="/login">
                          <LogIn className="size-4" />
                        </Link>
                      </Button>
                    </div>
                    {/* Dev-only door into onboarding, since this build has no
                        auth backend to come back from. */}
                    <Button
                      asChild
                      className="font-mono tracking-[1px] uppercase rounded-[2px] transition-all duration-300 bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground border border-dashed border-foreground/20 px-4 py-2 h-9 w-full text-xs"
                    >
                      <Link to="/onboarding">
                        <UserRound className="size-3.5" />
                        Temp sign-in
                      </Link>
                    </Button>
                  </>
                )}
                <Button
                  asChild
                  className="font-mono tracking-[1px] uppercase rounded-[2px] transition-all duration-300 bg-muted text-foreground hover:bg-muted/90 border border-foreground/5 px-4 py-2 h-9 w-full text-xs"
                >
                  <Link to="/pricing">Pricing</Link>
                </Button>
                <WalletButton />
              </li>
            </ul>
            <div className="-mx-2 -mb-2 flex items-center gap-2 px-3 pb-2.5 pt-1">
              <Switch
                checked={agents}
                onCheckedChange={setAgents}
                aria-label="Show agent-readable output"
              />
              <span className="font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground/70">
                Agent mode
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
