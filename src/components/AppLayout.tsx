import { useEffect, useRef, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Menu } from 'lucide-react'
import { AppSidebar } from '@/components/AppSidebar'
import { Composer } from '@/components/Composer'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useUi } from '@/state/ui'
import { useWallet } from '@/state/wallet'
import { MobileSidebar } from '@/components/MobileSidebar'

/**
 * The application shell: fixed sidebar + a single scroll container in <main>.
 * Below md the sidebar becomes a sheet and a floating pill nav takes over.
 */
export function AppLayout() {
  const {
    collapsed,
    setCollapsed,
    setMobileSidebar,
    account,
    authWallet,
    signOut,
  } = useUi()
  const wallet = useWallet()
  const navigate = useNavigate()
  const changingWallet = useRef(false)
  const [composerOpen, setComposerOpen] = useState(false)
  const location = useLocation()
  const focusedTaskOwnsMobileNavigation =
    location.pathname.startsWith('/chat/') ||
    location.pathname.startsWith('/onboarding')

  useEffect(() => {
    setComposerOpen(false)
    setMobileSidebar(false)
  }, [location.pathname, setMobileSidebar])

  useEffect(() => {
    if (
      !account ||
      !authWallet ||
      !wallet.pubkey ||
      wallet.pubkey === authWallet ||
      changingWallet.current
    ) {
      return
    }
    changingWallet.current = true
    void signOut()
      .then(() => navigate('/login', { replace: true }))
      .finally(() => {
        changingWallet.current = false
      })
  }, [account, authWallet, navigate, signOut, wallet.pubkey])

  return (
    <div
      data-slot="sidebar-wrapper"
      className="group/sidebar-wrapper flex h-svh w-full overflow-hidden"
      style={
        {
          '--sidebar-width': '12.5rem',
          '--sidebar-width-icon': '3rem',
        } as React.CSSProperties
      }
    >
      <AppSidebar />

      <main
        data-slot="sidebar-inset"
        className="relative flex w-full flex-1 flex-col bg-background"
      >
        {collapsed ? (
          <button
            type="button"
            aria-label="Expand sidebar"
            onClick={() => setCollapsed(false)}
            className="fixed left-3 top-3 z-30 hidden size-7 items-center justify-center rounded-sm bg-white text-sidebar-foreground/70 shadow-lg shadow-black/5 transition-colors hover:text-foreground md:flex"
          >
            <svg
              className="lucide lucide-panel-left size-4"
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect width="18" height="18" x="3" y="3" rx="2" />
              <path d="M9 3v18" />
            </svg>
          </button>
        ) : null}

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <Outlet />
          {!focusedTaskOwnsMobileNavigation ? (
            <div className="h-24 shrink-0 md:hidden" aria-hidden="true" />
          ) : null}
        </div>

        {/* Mobile pill nav ------------------------------------------------ */}
        {!focusedTaskOwnsMobileNavigation ? (
          <nav
            aria-label="Mobile actions"
            className={cn(
              'fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-1/2 z-40 flex -translate-x-1/2 items-center rounded-md border border-border/60 bg-card/90 shadow-xl backdrop-blur-sm transition-all duration-300 ease-out md:hidden',
              'py-2.5 pr-2.5',
            )}
          >
            <button
              type="button"
              aria-label="Open sidebar"
              onClick={() => setMobileSidebar(true)}
              className="flex size-11 shrink-0 cursor-pointer items-center justify-center text-foreground"
            >
              <Menu className="size-4" />
            </button>
            <div className="ml-1.5 max-w-[200px] overflow-hidden opacity-100 transition-all duration-300 ease-out">
              <Button
                type="button"
                onClick={() => setComposerOpen(true)}
                className="h-11 rounded-[2px] border border-foreground/80 bg-foreground/85 px-4 text-xs text-background transition-all duration-300 hover:bg-foreground/75"
              >
                New question
              </Button>
            </div>
          </nav>
        ) : null}

        {/* Mobile composer sheet ------------------------------------------ */}
        <div
          className={cn(
            'fixed inset-0 z-50 md:hidden',
            composerOpen ? '' : 'pointer-events-none',
          )}
        >
          <div
            onClick={() => setComposerOpen(false)}
            className={cn(
              'absolute inset-0 bg-black/40 transition-opacity duration-200',
              composerOpen ? 'opacity-100' : 'opacity-0',
            )}
          />
          <div
            className={cn(
              'absolute inset-x-0 top-0 border-b border-border bg-background p-3 transition-transform duration-200',
              composerOpen ? 'translate-y-0' : '-translate-y-full',
            )}
          >
            <Composer
              variant="flat"
              autoFocus={composerOpen}
              onSubmitted={() => setComposerOpen(false)}
            />
          </div>
        </div>

        <MobileSidebar />
      </main>
    </div>
  )
}
