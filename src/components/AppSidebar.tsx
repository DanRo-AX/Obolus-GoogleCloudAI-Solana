import { Fragment } from 'react'
import { NavLink, Link } from 'react-router-dom'
import {
  ChevronDown,
  Languages,
  LogIn,
  LogOut,
  PanelLeft,
  Waypoints,
} from 'lucide-react'
import { Avatar } from '@/components/Avatar'
import { BrandMark } from '@/components/ui/BrandMark'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/primitives'
import { NAV_ITEMS } from '@/data/nav'
import { STRIKE_LIMIT } from '@/data/onboarding'
import { deterministicAvatar } from '@/lib/avatar'
import { formatUsdcShort } from '@/lib/usdc'
import { cn } from '@/lib/utils'
import { useLang, useT } from '@/i18n'
import { useUi } from '@/state/ui'
import { useWallet } from '@/state/wallet'

const MENU_BUTTON =
  'peer/menu-button flex w-full items-center gap-2 overflow-hidden text-left font-medium outline-hidden transition-[width,height,padding] focus-visible:ring-2 focus-visible:ring-sidebar-ring active:bg-sidebar-accent active:text-sidebar-accent-foreground disabled:pointer-events-none disabled:opacity-50 [&>span:last-child]:truncate [&>svg]:shrink-0'

function AdminMenu() {
  return (
    <li className="relative mt-1 border-t border-sidebar-border pt-2">
      <NavLink
        to="/admin"
        className={({ isActive }) =>
          cn(
            MENU_BUTTON,
            'flex h-8 items-center gap-2.5 rounded-[4px] px-2 text-[13px] tracking-[-0.006em] transition-colors [&>svg]:size-[15px]',
            isActive
              ? 'bg-background font-medium text-foreground shadow-[0_1px_2px_rgba(20,20,25,0.05)]'
              : 'text-muted-foreground hover:bg-foreground/[0.045] hover:text-foreground',
          )
        }
      >
        <Waypoints className="opacity-70" />
        <span>Admin Test</span>
      </NavLink>
    </li>
  )
}

/**
 * Signed-in state. The strike counter sits here on purpose — a three-strike
 * rule you only ever see once, on the way in, is not a rule anybody remembers.
 */
function ProfileChip({ onSignOut }: { onSignOut: () => Promise<void> }) {
  const { profile, suspended } = useUi()
  const t = useT()
  if (!profile) return null
  return (
    <div
      className={cn(
        'border-t pt-2',
        suspended ? 'border-destructive/40' : 'border-border',
      )}
    >
      <div className="flex items-center gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-foreground/[0.045]">
        <Avatar
          config={profile.avatar ?? deterministicAvatar(profile.handle)}
          size={30}
          className="shrink-0"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium text-foreground">
            {profile.handle}
          </p>
          <p className="truncate text-[10px] text-muted-foreground">
            {suspended
              ? t('Suspended')
              : `${profile.speaksTo.length} ${t('topics')}`}
            {' · '}
            <span className={cn(profile.strikes > 0 && 'text-destructive')}>
              {t('strike')} {profile.strikes}/{STRIKE_LIMIT}
            </span>
          </p>
        </div>
        <button
          type="button"
          onClick={() => void onSignOut()}
          aria-label={t('Disconnect Phantom')}
          className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground/55 transition-colors hover:bg-background hover:text-foreground"
        >
          <LogOut className="size-3.5" />
        </button>
      </div>
    </div>
  )
}

/**
 * The two numbers that bring somebody back: USDC currently available to spend without
 * another wallet transfer, and open calls in the fields they claimed. Both are links —
 * a figure you cannot act on is decoration.
 */
function LiveStrip() {
  const { prepaidBalance, orders, profile } = useUi()
  const t = useT()

  const open = orders.filter((o) => !o.mine && o.answered < o.target)
  const fits = profile
    ? open.filter((o) => profile.speaksTo.includes(o.category)).length
    : open.length
  const available = prepaidBalance
    ? formatUsdcShort(prepaidBalance.availableAtomic) ?? '0.00'
    : '—'

  return (
    <div className="grid grid-cols-2 border-t border-border pt-2">
      <Link
        to="/memory"
        className="flex min-w-0 flex-col gap-1 rounded-lg px-2 py-2 transition-colors hover:bg-foreground/[0.045]"
      >
        <span className="text-[10px] text-muted-foreground">
          {t('Prepaid balance')}
        </span>
        <span
          className="truncate text-[14px] font-medium leading-none tabular-nums text-foreground"
          title={prepaidBalance ? `${available} USDC` : undefined}
        >
          {available}{prepaidBalance ? ' USDC' : ''}
        </span>
      </Link>
      <Link
        to="/dashboard"
        className="flex min-w-0 flex-col gap-1 rounded-lg px-2 py-2 text-muted-foreground transition-colors hover:bg-foreground/[0.045] hover:text-foreground"
      >
        <span className="text-[10px]">{profile ? t('Fit you') : t('Open now')}</span>
        <span
          className={cn(
            'text-[14px] font-medium leading-none tabular-nums',
            fits > 0 ? 'text-foreground' : 'text-muted-foreground/70',
          )}
        >
          {fits} {fits === 1 ? t('call') : t('calls')}
        </span>
      </Link>
    </div>
  )
}

/**
 * Two languages, one control — a Radix dropdown styled to match the sidebar's
 * mono controls (@radix-ui/react-dropdown-menu via the ui/primitives wrappers,
 * not a native <select>). The trigger carries the "Lang" caption and the
 * current language; the menu lists EN / 한국어 with a checkmark on the active
 * one. Radix hands us keyboard, focus and aria for free. The locale wiring is
 * unchanged from the old <select> — the same useLang().setLang, which still
 * persists to localStorage and re-renders every t().
 */
function LangSwitch() {
  const { lang, setLang } = useLang()
  const t = useT()
  const current = lang === 'ko' ? '한국어' : 'EN'
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`${t('Lang')} · ${current}`}
        className="group/lang flex h-9 w-full cursor-pointer items-center justify-between gap-2 rounded-lg border-0 bg-transparent px-2 text-[11px] text-muted-foreground outline-hidden transition-colors hover:bg-foreground/[0.045] hover:text-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring data-[state=open]:bg-foreground/[0.045] data-[state=open]:text-foreground"
      >
        <span className="flex min-w-0 items-center gap-2">
          <Languages className="size-3.5 shrink-0 opacity-70" />
          <span className="truncate">{t('Lang')}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          <span className="text-[11px] text-foreground">
            {current}
          </span>
          <ChevronDown className="size-3.5 shrink-0 opacity-60 transition-transform duration-200 group-data-[state=open]/lang:rotate-180" />
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="start"
        sideOffset={6}
        className="w-(--radix-dropdown-menu-trigger-width)"
      >
        <DropdownMenuCheckboxItem
          checked={lang === 'en'}
          onCheckedChange={() => setLang('en')}
          className="font-mono text-[11px] uppercase tracking-[1px]"
        >
          EN
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={lang === 'ko'}
          onCheckedChange={() => setLang('ko')}
          className="text-[13px]"
        >
          한국어
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function AppSidebar() {
  const {
    collapsed,
    setCollapsed,
    profile,
    account,
    signOut,
    prepaidBalance,
  } = useUi()
  const wallet = useWallet()
  const t = useT()
  const disconnect = async () => {
    await signOut()
    await wallet.disconnect()
  }

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
                      'h-11 cursor-pointer rounded-[4px] px-1.5 hover:bg-foreground/[0.04]',
                    )}
                  >
                    <div className="flex aspect-square size-8 items-center justify-center">
                      <BrandMark />
                    </div>
                    <span className="truncate text-[15px] font-semibold tracking-[-0.02em]">
                      Obolus
                    </span>
                  </Link>
                </div>
                <button
                  type="button"
                  aria-label={t('Collapse sidebar')}
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
              {NAV_ITEMS.map(({ to, label, Icon, end, dividerBefore }) => (
                <Fragment key={to}>
                  {dividerBefore ? (
                    <li
                      aria-hidden="true"
                      className="mx-2 my-1.5 h-px bg-sidebar-border"
                    />
                  ) : null}
                  <li
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
                          'group/nav flex h-8 items-center gap-2.5 rounded-[4px] px-2 text-[13px] tracking-[-0.006em] transition-colors [&>svg]:size-[15px] [&>svg]:shrink-0',
                          isActive && to !== '/'
                            ? 'bg-background font-medium text-foreground shadow-[0_1px_2px_rgba(20,20,25,0.05)]'
                            : 'text-muted-foreground hover:bg-foreground/[0.045] hover:text-foreground',
                        )
                      }
                    >
                      <Icon className="opacity-70" />
                      <span>{t(label)}</span>
                    </NavLink>
                  </li>
                </Fragment>
              ))}
              {account ? (
                <AdminMenu />
              ) : null}
              </ul>
            </div>
          </div>

          {/* Footer — auth CTAs, agents switch, theme toggle ------------- */}
          <div data-slot="sidebar-footer" className="flex flex-col gap-1 p-2">
            <ul
              data-slot="sidebar-menu"
              className="flex w-full min-w-0 flex-col gap-1"
            >
              <li
                data-slot="sidebar-menu-item"
                className="group/menu-item relative flex flex-col gap-1"
              >
                <LiveStrip />
                <LangSwitch />
                {profile ? (
                  <ProfileChip onSignOut={disconnect} />
                ) : account ? (
                  <div className="space-y-2 border-t border-border pt-2.5">
                    <p className="px-1 text-xs leading-5 text-muted-foreground">
                      {formatUsdcShort(prepaidBalance?.availableAtomic ?? '0') ?? '0.00'} USDC {t('available for evidence opens')}
                    </p>
                    <div className="flex gap-2">
                      <Button asChild variant="mono" size="monoSm" className="flex-1">
                        <Link to="/onboarding">{t('Set up your database')}</Link>
                      </Button>
                      <Button
                        variant="monoMuted"
                        size="monoSm"
                        aria-label={t('Disconnect Phantom')}
                        onClick={() => void disconnect()}
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
                        <Link to="/login">{t('Connect wallet')}</Link>
                      </Button>
                      <Button
                        asChild
                        aria-label={t('Connect a Phantom wallet you already have')}
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
          </div>
        </div>
      </div>
    </div>
  )
}
