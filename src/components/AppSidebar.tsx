import { NavLink, Link } from 'react-router-dom'
import { Activity, LogIn, LogOut, PanelLeft, ShieldCheck } from 'lucide-react'
import { Avatar } from '@/components/Avatar'
import { BrandMark } from '@/components/ui/BrandMark'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/primitives'
import { NAV_ITEMS } from '@/data/nav'
import { STRIKE_LIMIT } from '@/data/onboarding'
import { deterministicAvatar } from '@/lib/avatar'
import { cn } from '@/lib/utils'
import { useLang, useT } from '@/i18n'
import { useUi } from '@/state/ui'
import { shortKey, useWallet } from '@/state/wallet'

const MENU_BUTTON =
  'peer/menu-button flex w-full items-center gap-2 overflow-hidden text-left font-medium outline-hidden transition-[width,height,padding] focus-visible:ring-2 focus-visible:ring-sidebar-ring active:bg-sidebar-accent active:text-sidebar-accent-foreground disabled:pointer-events-none disabled:opacity-50 [&>span:last-child]:truncate [&>svg]:shrink-0'

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
        'border-t pt-2.5',
        suspended ? 'border-destructive/40' : 'border-border',
      )}
    >
      {/* Avatar + handle + status caption, one tidy row instead of a bare
          color dot next to bare text. */}
      <div className="flex items-center gap-2.5">
        <Avatar
          config={profile.avatar ?? deterministicAvatar(profile.handle)}
          size={28}
          className="shrink-0"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-[11px] tracking-[1px] text-foreground">
            {profile.handle}
          </p>
          <p className="truncate font-mono text-[9px] uppercase tracking-[0.8px] text-muted-foreground">
            {suspended
              ? t('Suspended')
              : `${profile.speaksTo.length} ${t('shelves')}`}
            {' · '}
            <span className={cn(profile.strikes > 0 && 'text-destructive')}>
              {t('strike')} {profile.strikes} {t('of')} {STRIKE_LIMIT}
            </span>
          </p>
        </div>
        <button
          type="button"
          onClick={() => void onSignOut()}
          aria-label={t('Disconnect Phantom')}
          className="shrink-0 cursor-pointer text-muted-foreground/60 transition-colors hover:text-foreground"
        >
          <LogOut className="size-3.5" />
        </button>
      </div>
      <div className="mt-2 border-t border-border/70 pt-2 font-mono text-[9px] leading-relaxed text-muted-foreground">
        <p className="mt-0.5 truncate uppercase tracking-[0.7px]">
          {t('Wallet')} · {profile.wallet ? `${profile.wallet.slice(0, 4)}…${profile.wallet.slice(-4)} · ${profile.walletVerified ? t('verified') : t('unverified')}` : t('not connected')}
        </p>
      </div>
    </div>
  )
}

/**
 * The two numbers that bring somebody back: what the shelf has earned, and how
 * many open calls are sitting in the fields they claimed. Both are links —
 * a figure you cannot act on is decoration.
 */
function LiveStrip() {
  const { earnings, orders, profile } = useUi()
  const t = useT()

  const open = orders.filter((o) => !o.mine && o.answered < o.target)
  const fits = profile
    ? open.filter((o) => profile.speaksTo.includes(o.category)).length
    : open.length
  const earned = earnings?.accruedKrw ?? 0
  const held = earnings?.heldKrw ?? 0

  return (
    <div className="flex flex-col divide-y divide-border/70 border-y border-border/70">
      {/* Earnings is the number that brings somebody back — it gets the
          stat treatment (small caption, big tabular figure) instead of
          sharing a text row with the call count below it. */}
      <Link
        to="/memory"
        className="flex flex-col gap-0.5 px-2.5 py-2.5 transition-colors hover:bg-foreground/[0.03]"
      >
        <span className="font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">
          {profile ? t('Earned') : t('Paid out')}
        </span>
        <span className="font-host text-lg font-medium leading-none tabular-nums text-foreground">
          ₩{earned.toLocaleString()}
          {held ? (
            <span className="ml-1 font-mono text-[10px] font-normal normal-case tracking-normal text-muted-foreground">
              · ₩{held.toLocaleString()} {t('held')}
            </span>
          ) : null}
        </span>
      </Link>
      <Link
        to="/dashboard"
        className="flex items-baseline justify-between gap-2 px-2.5 py-2 font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground transition-colors hover:bg-foreground/[0.03] hover:text-foreground"
      >
        <span>{profile ? t('Fit you') : t('Open now')}</span>
        <span
          className={cn(
            'tabular-nums',
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
 * Two languages, one control — now the same Chip grammar as the dashboard's
 * filter row instead of a bespoke pill-in-a-tray.
 */
function LangSwitch() {
  const { lang, setLang } = useLang()
  return (
    <div className="flex items-center gap-1.5">
      {(['en', 'ko'] as const).map((code) => (
        <Chip
          key={code}
          active={lang === code}
          onClick={() => setLang(code)}
          aria-pressed={lang === code}
          className="h-8 flex-1 justify-center"
        >
          {code === 'en' ? 'EN' : '한국어'}
        </Chip>
      ))}
    </div>
  )
}

export function AppSidebar() {
  const {
    collapsed,
    setCollapsed,
    profile,
    account,
    authWallet,
    signOut,
    balance,
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
              ))}
              {account?.role === 'admin' ? (
                <>
                  <li className="relative">
                    <NavLink
                      to="/admin/operations"
                      className={({ isActive }) =>
                        cn(
                          MENU_BUTTON,
                          'group/nav flex h-8 items-center gap-2.5 rounded-[4px] px-2 text-[13px] tracking-[-0.006em] transition-colors [&>svg]:size-[15px] [&>svg]:shrink-0',
                          isActive
                            ? 'bg-background font-medium text-foreground shadow-[0_1px_2px_rgba(20,20,25,0.05)]'
                            : 'text-muted-foreground hover:bg-foreground/[0.045] hover:text-foreground',
                        )
                      }
                    >
                      <Activity className="opacity-70" />
                      <span>{t('Operations')}</span>
                    </NavLink>
                  </li>
                  <li className="relative">
                    <NavLink
                      to="/admin/disputes"
                      className={({ isActive }) =>
                        cn(
                          MENU_BUTTON,
                          'group/nav flex h-8 items-center gap-2.5 rounded-[4px] px-2 text-[13px] tracking-[-0.006em] transition-colors [&>svg]:size-[15px] [&>svg]:shrink-0',
                          isActive
                            ? 'bg-background font-medium text-foreground shadow-[0_1px_2px_rgba(20,20,25,0.05)]'
                            : 'text-muted-foreground hover:bg-foreground/[0.045] hover:text-foreground',
                        )
                      }
                    >
                      <ShieldCheck className="opacity-70" />
                      <span>{t('Disputes')}</span>
                    </NavLink>
                  </li>
                </>
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
                <LiveStrip />
                <LangSwitch />
                {profile ? (
                  <ProfileChip onSignOut={disconnect} />
                ) : account ? (
                  <div className="space-y-2 border-t border-border pt-2.5">
                    <p className="truncate font-mono text-[10px] text-muted-foreground">
                      {authWallet
                        ? `${t('Wallet')} · ${shortKey(authWallet)}`
                        : t('Wallet signed in')}
                    </p>
                    <p className="font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">
                      ₩{(balance?.availableKrw ?? 0).toLocaleString()} {t('sandbox for opens')}
                    </p>
                    <div className="flex gap-2">
                      <Button asChild variant="mono" size="monoSm" className="flex-1">
                        <Link to="/onboarding">{t('Set up your shelf')}</Link>
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
