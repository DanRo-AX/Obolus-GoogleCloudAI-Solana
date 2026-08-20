import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import {
  Coins,
  Download,
  Flame,
  Loader2,
  Lock,
  Plus,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Star,
  Trash2,
  Unlock,
  Wallet,
  ReceiptText,
  RefreshCw,
} from 'lucide-react'
import { AuthUnavailable } from '@/components/AuthUnavailable'
import { Avatar } from '@/components/Avatar'
import { AvatarPicker } from '@/components/AvatarPicker'
import { CategoryIcon } from '@/components/CategoryIcon'
import { AuroraCreditCard } from '@/components/ui/aurora-credit-card-bento'
import { Button } from '@/components/ui/button'
import {
  Badge,
  Banner,
  Chip,
  Switch,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/primitives'
import { CATEGORIES, CATEGORY_BY_ID, categoryFor, type CategoryId } from '@/data/categories'
import {
  AGE_BANDS,
  AUTO_MATCH_STRIKE_LIMIT,
  HOUSEHOLDS,
  REGIONS,
  STRIKE_LIMIT,
  YEAR_BANDS,
} from '@/data/onboarding'
import { useT } from '@/i18n'
import {
  exportAccount,
  getPrepaidBalance,
  setMemoryLocked,
  withdrawPrepaidBalance,
} from '@/lib/api'
import { deterministicAvatar, type AvatarConfig } from '@/lib/avatar'
import { formatUsdc, formatUsdcFromKrw, formatUsdcShort, parseUsdcAtomic } from '@/lib/usdc'
import { cn } from '@/lib/utils'
import { ArchivePanel } from '@/pages/Archive'
import { TransactionsPanel } from '@/pages/Transactions'
import { useUi } from '@/state/ui'
import { getPhantom, shortKey, useDevnetUsdcBalance, useWallet } from '@/state/wallet'

/**
 * Screen 03 — My memory / my-page hub. Everything you have answered piles up
 * here. The thicker it gets, the better auto-match sticks, until money
 * arrives without you answering anything new. Recency weighting is shown,
 * not hidden.
 *
 * Four tabs instead of four destinations: 프로필 (profile edit), 내 답변·수익
 * (this page's original body — the default), 내 질문 (Archive's content,
 * still reachable on its own at /archive) and 내역 (Transactions' content,
 * still reachable on its own at /transactions). Folding them here means one
 * my-page instead of four sidebar entries for the same account.
 */
/** Whole-USDC top-up steps offered by the 충전하기 control (min 1 USDC). */
const TOP_UP_STEPS_USDC = [1, 5, 10, 25] as const
/** Below this prepaid balance we surge the "충전하시겠어요?" prompt (1 USDC). */
const LOW_BALANCE_ATOMIC = 1_000_000

export default function Memory() {
  const {
    memory,
    earnings,
    autoMatch,
    setAutoMatch,
    profile,
    disputeStrike,
    refreshLedger,
    account,
    authReady,
    authError,
    retryAuth,
    balance,
    verifyPayoutWallet,
    deleteCurrentAccount,
    saveProfile,
  } = useUi()
  const navigate = useNavigate()
  const t = useT()
  const [disputingId, setDisputingId] = useState<string | null>(null)
  const [draftDisputeId, setDraftDisputeId] = useState<string | null>(null)
  const [disputeReason, setDisputeReason] = useState('')
  const [disputeError, setDisputeError] = useState<string | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [lockingId, setLockingId] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [memoryActionError, setMemoryActionError] = useState<string | null>(null)
  /** USDC prepaid pot (`prepaid_accounts.available_atomic`), null while unknown. */
  const [prepaidAtomic, setPrepaidAtomic] = useState<string | null>(null)

  const toggleMemoryLock = async (memoryId: string, locked: boolean) => {
    setLockingId(memoryId)
    setMemoryActionError(null)
    try {
      await setMemoryLocked(memoryId, locked)
      await refreshLedger()
    } catch (error) {
      setMemoryActionError(
        error instanceof Error
          ? error.message
          : t('The lock did not change. Try it again.'),
      )
    } finally {
      setLockingId(null)
    }
  }

  const downloadExport = async () => {
    setExporting(true)
    setMemoryActionError(null)
    try {
      const data = await exportAccount()
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: 'application/json',
      })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `obolus-export-${new Date().toISOString().slice(0, 10)}.json`
      link.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      setMemoryActionError(
        error instanceof Error
          ? error.message
          : t('The export did not build. Try it again.'),
      )
    } finally {
      setExporting(false)
    }
  }

  const dispute = async (memoryId: string) => {
    if (disputingId) return
    setDisputingId(memoryId)
    setDisputeError(null)
    try {
      await disputeStrike(memoryId, disputeReason)
      setDraftDisputeId(null)
      setDisputeReason('')
    } catch (error) {
      setDisputeError(
        error instanceof Error
          ? error.message
          : t('The dispute did not send. Try it again.'),
      )
    } finally {
      setDisputingId(null)
    }
  }

  const wallet = useWallet()
  const walletUsdc = useDevnetUsdcBalance(wallet.pubkey)
  const [verifying, setVerifying] = useState(false)
  const [withdrawing, setWithdrawing] = useState(false)
  const [walletError, setWalletError] = useState<string | null>(null)

  /**
   * Saving a payout address only records a string. Proving the address is
   * yours means signing a challenge with it — otherwise anyone could point
   * earnings at somebody else's wallet.
   */
  const verifyOwnership = async () => {
    if (!profile?.wallet || verifying) return
    const provider = getPhantom()
    if (!provider?.signMessage) {
      setWalletError(t('Connect your wallet to sign the challenge.'))
      return
    }
    setWalletError(null)
    setVerifying(true)
    try {
      await verifyPayoutWallet(profile.wallet, async (message: string) => {
        const signed = await provider.signMessage!(
          new TextEncoder().encode(message),
          'utf8',
        )
        const bytes = signed instanceof Uint8Array ? signed : signed.signature
        return btoa(String.fromCharCode(...bytes))
      })
    } catch (e) {
      setWalletError(
        e instanceof Error ? e.message : t('The signature was not accepted.'),
      )
    } finally {
      setVerifying(false)
    }
  }

  /**
   * Sending the sandbox balance back out to the payout wallet. This used to
   * hang off the sidebar wallet control; it belongs next to the balance it
   * moves, which is here.
   */
  const withdrawBalance = async () => {
    if (withdrawing) return
    setWalletError(null)
    setWithdrawing(true)
    try {
      await withdrawPrepaidBalance()
      await refreshLedger()
    } catch (e) {
      setWalletError(
        e instanceof Error ? e.message : t('The withdrawal did not go through.'),
      )
    } finally {
      setWithdrawing(false)
    }
  }

  /** 프로필 · 내 답변·수익 · 내 질문 · 내역 — the four tabs of the my-page hub. */
  const [tab, setTab] = useState<'profile' | 'answers' | 'questions' | 'transactions'>(
    'answers',
  )
  const [avatarDraft, setAvatarDraft] = useState<AvatarConfig | null>(null)
  const [handleDraft, setHandleDraft] = useState('')
  const [ageBandDraft, setAgeBandDraft] = useState('')
  const [regionDraft, setRegionDraft] = useState('')
  const [householdDraft, setHouseholdDraft] = useState('')
  const [fieldDraft, setFieldDraft] = useState<CategoryId | ''>('')
  const [yearsDraft, setYearsDraft] = useState('')
  const [speaksToDraft, setSpeaksToDraft] = useState<CategoryId[]>([])
  const [savingProfile, setSavingProfile] = useState(false)
  const [profileError, setProfileError] = useState<string | null>(null)

  /**
   * The avatar picker used to be its own small panel, then the "edit
   * profile" surface toggled open from the avatar button. It is now the
   * 프로필 tab, so the handle and answerable-fields changes that previously
   * only existed at onboarding have somewhere to live post-signup.
   */
  const openProfilePanel = () => {
    if (!profile) return
    setAvatarDraft(profile.avatar ?? deterministicAvatar(profile.handle))
    setHandleDraft(profile.handle)
    setAgeBandDraft(profile.ageBand)
    setRegionDraft(profile.region)
    setHouseholdDraft(profile.household)
    setFieldDraft(profile.field)
    setYearsDraft(profile.years)
    setSpeaksToDraft(profile.speaksTo)
    setProfileError(null)
    setTab('profile')
  }

  const toggleSpeaksToDraft = (id: CategoryId) =>
    setSpeaksToDraft((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )

  const canSaveProfile =
    handleDraft.trim().length >= 3 &&
    Boolean(ageBandDraft && regionDraft && householdDraft && fieldDraft && yearsDraft) &&
    speaksToDraft.length > 0

  const saveProfileEdit = async () => {
    if (!profile || !avatarDraft || !fieldDraft || !canSaveProfile || savingProfile) return
    setSavingProfile(true)
    setProfileError(null)
    try {
      await saveProfile({
        handle: handleDraft.trim().toUpperCase(),
        ageBand: ageBandDraft,
        region: regionDraft,
        household: householdDraft,
        field: fieldDraft,
        years: yearsDraft,
        speaksTo: speaksToDraft,
        wallet: profile.wallet,
        browserAlerts: profile.browserAlerts,
        emailAlerts: profile.emailAlerts,
        avatar: avatarDraft,
      })
      setTab('answers')
    } catch (error) {
      setProfileError(
        error instanceof Error
          ? error.message
          : t('The profile did not save. Try again.'),
      )
    } finally {
      setSavingProfile(false)
    }
  }

  const settled = memory.filter((m) => m.status !== 'voided')
  const total =
    earnings?.accruedKrw ?? settled.reduce((sum, entry) => sum + entry.earned, 0)
  /**
   * Headline balance card figure ("Total USDC held") — the user's REAL USDC:
   * the prepaid pot (`prepaid_accounts.available_atomic`, funded by on-chain
   * top-ups) plus accrued, claimable earnings. Both are independent 6-decimal
   * atomic ledgers, so add them as bigints rather than floats. We deliberately
   * do NOT read the legacy promotional ledger (`balance.availableAtomic`): it
   * once carried unbacked signup credit and already folds accrued earnings in,
   * which would double-count them here. When neither atomic field has loaded,
   * the UI stays unknown instead of estimating a coin balance from legacy KRW.
   */
  const headlineAtomicUsdc =
    prepaidAtomic != null || earnings?.accruedAtomic != null
      ? formatUsdcShort(
          (parseUsdcAtomic(prepaidAtomic) + parseUsdcAtomic(earnings?.accruedAtomic)).toString(),
        )
      : null
  const answeredViaAutoMatch = settled
    .filter((m) => m.via === 'Auto-match')
    .reduce((s, m) => s + m.earned, 0)
  const documentOpenEarnings =
    earnings?.events
      .filter((event) => event.source === 'document_open')
      .reduce((sum, event) => sum + event.amountKrw, 0) ?? 0
  const autoEarned = answeredViaAutoMatch + documentOpenEarnings
  const voided = memory.filter((m) => m.status === 'voided')

  useEffect(() => {
    if (!authReady || !account) return
    void refreshLedger().catch(() => undefined)
  }, [account, authReady, refreshLedger])

  /**
   * The USDC prepaid pot is read on its own — `GET /api/v1/prepaid/balance`
   * only resolves once a Phantom wallet is linked, so a failure here just
   * leaves the balance unknown (the top-up control still renders).
   */
  useEffect(() => {
    if (!authReady || !account) return
    void getPrepaidBalance()
      .then((b) => setPrepaidAtomic(b.availableAtomic))
      .catch(() => setPrepaidAtomic(null))
  }, [account, authReady])

  const shelves = useMemo(() => {
    const map = new Map<string, number>()
    for (const m of memory) map.set(m.shelf, (map.get(m.shelf) ?? 0) + 1)
    return [...map.entries()].sort((a, b) => b[1] - a[1])
  }, [memory])

  /** Recent entries weigh more, old ones fade — the memory stream's weighting. */
  const weightOf = (ts: number) => {
    const days = (Date.now() - ts) / (1000 * 60 * 60 * 24)
    return Math.max(0.2, Math.min(1, 2 ** (-days / 90)))
  }

  if (!authReady) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    )
  }
  if (authError && !account) {
    return <AuthUnavailable message={authError} onRetry={retryAuth} />
  }
  if (!account) return <Navigate to="/login" replace />

  return (
    <div className="page-enter flex-1 overflow-y-auto bg-background">
      <div className="mx-auto w-full max-w-[88rem] px-5 py-7 sm:px-8 lg:px-10 lg:py-10">
        <div className="flex flex-col gap-5 sm:min-h-10 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
          <div className="flex min-w-0 items-center gap-3">
            {profile ? (
              <button
                type="button"
                onClick={() => (tab === 'profile' ? setTab('answers') : openProfilePanel())}
                aria-label={t('Edit profile')}
                className="cursor-pointer rounded-full outline-none transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <Avatar
                  config={profile.avatar ?? deterministicAvatar(profile.handle)}
                  size={36}
                />
              </button>
            ) : null}
            <div className="min-w-0">
              <h1 className="font-sans text-xl font-semibold tracking-[-0.02em]">
                {t('My database')}
              </h1>
              <p className="mt-1 max-w-xl text-sm leading-6 text-muted-foreground">
                {t('Manage the answers you own, their reuse, and every settlement.')}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 sm:shrink-0 sm:justify-end">
            <Button
              variant="monoGhost"
              size="monoSm"
              disabled={exporting}
              onClick={() => void downloadExport()}
            >
              {exporting ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Download className="size-3" />
              )}
              {t('Export')}
            </Button>
            {account?.role === 'admin' ? (
              <Button asChild variant="mono" size="monoSm">
                <Link to="/admin">
                  <ShieldCheck className="size-3" />
                  Admin Test
                </Link>
              </Button>
            ) : null}
            <Button asChild variant="monoGhost" size="monoSm">
              <Link to="/dashboard">{t('Browse open calls')}</Link>
            </Button>
          </div>
        </div>

        <div className="mt-8 flex items-center gap-7 overflow-x-auto border-b border-border/70 whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <MemoryTab active={tab === 'profile'} onClick={openProfilePanel}>
            {t('Profile')}
          </MemoryTab>
          <MemoryTab active={tab === 'answers'} onClick={() => setTab('answers')}>
            {t('My answers & earnings')}
          </MemoryTab>
          <MemoryTab active={tab === 'questions'} onClick={() => setTab('questions')}>
            {t('My questions')}
          </MemoryTab>
          <MemoryTab active={tab === 'transactions'} onClick={() => setTab('transactions')}>
            {t('Transactions')}
          </MemoryTab>
        </div>

        {memoryActionError ? (
          <p className="mt-6 rounded-[4px] border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {memoryActionError}
          </p>
        ) : null}

        {tab === 'profile' && avatarDraft ? (
          <Banner tone="neutral" className="mt-8 overflow-hidden p-0">
            <div className="divide-y divide-border/60">
              <div className="p-4">
                <p className="font-mono text-[11px] uppercase tracking-[1px] text-muted-foreground">
                  {t('Edit profile')}
                </p>
                <p className="mt-3 font-mono text-[11px] uppercase tracking-[1px] text-muted-foreground">
                  {t('Change avatar')}
                </p>
                <div className="mt-2">
                  <AvatarPicker
                    value={avatarDraft}
                    onChange={setAvatarDraft}
                    fallbackSeed={handleDraft}
                  />
                </div>
              </div>

              <div className="p-4">
                <p className="font-mono text-[11px] uppercase tracking-[1px] text-muted-foreground">
                  {t('Pick a handle')}
                </p>
                <input
                  value={handleDraft}
                  onChange={(e) => setHandleDraft(e.target.value)}
                  spellCheck={false}
                  className="mt-2 h-10 w-full max-w-xs rounded-[2px] border border-border bg-transparent px-3 font-mono text-sm uppercase tracking-[1px] outline-none transition-colors focus:border-foreground/40"
                />
              </div>

              <div className="flex flex-col gap-4 p-4">
                <div>
                  <p className="font-mono text-[11px] uppercase tracking-[1px] text-muted-foreground">
                    {t('Age')}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {AGE_BANDS.map((o) => (
                      <Chip
                        key={o.value}
                        active={ageBandDraft === o.value}
                        onClick={() => setAgeBandDraft(o.value)}
                      >
                        {t(o.label)}
                      </Chip>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="font-mono text-[11px] uppercase tracking-[1px] text-muted-foreground">
                    {t('Where you live')}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {REGIONS.map((o) => (
                      <Chip
                        key={o.value}
                        active={regionDraft === o.value}
                        onClick={() => setRegionDraft(o.value)}
                      >
                        {t(o.label)}
                      </Chip>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="font-mono text-[11px] uppercase tracking-[1px] text-muted-foreground">
                    {t('Household')}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {HOUSEHOLDS.map((o) => (
                      <Chip
                        key={o.value}
                        active={householdDraft === o.value}
                        onClick={() => setHouseholdDraft(o.value)}
                      >
                        {t(o.label)}
                      </Chip>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-4 p-4">
                <div>
                  <p className="font-mono text-[11px] uppercase tracking-[1px] text-muted-foreground">
                    {t('What do you do?')}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {CATEGORIES.map((c) => (
                      <Chip
                        key={c.id}
                        active={fieldDraft === c.id}
                        onClick={() => setFieldDraft(c.id)}
                      >
                        {t(c.label)}
                      </Chip>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="font-mono text-[11px] uppercase tracking-[1px] text-muted-foreground">
                    {t('How long')}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {YEAR_BANDS.map((o) => (
                      <Chip
                        key={o.value}
                        active={yearsDraft === o.value}
                        onClick={() => setYearsDraft(o.value)}
                      >
                        {t(o.label)}
                      </Chip>
                    ))}
                  </div>
                </div>
              </div>

              <div className="p-4">
                <p className="font-mono text-[11px] uppercase tracking-[1px] text-muted-foreground">
                  {t('What can you answer?')}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {CATEGORIES.map((c) => (
                    <Chip
                      key={c.id}
                      active={speaksToDraft.includes(c.id)}
                      onClick={() => toggleSpeaksToDraft(c.id)}
                    >
                      {t(c.label)}
                    </Chip>
                  ))}
                </div>
              </div>

              <div className="p-4">
                {profileError ? (
                  <p className="mb-3 text-sm text-destructive">{profileError}</p>
                ) : null}
                <div className="flex gap-2">
                  <Button
                    variant="mono"
                    size="monoSm"
                    disabled={!canSaveProfile || savingProfile}
                    onClick={() => void saveProfileEdit()}
                  >
                    {savingProfile ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : null}
                    {savingProfile ? t('Saving…') : t('Save profile')}
                  </Button>
                  <Button
                    variant="monoGhost"
                    size="monoSm"
                    disabled={savingProfile}
                    onClick={() => setTab('answers')}
                  >
                    {t('Cancel')}
                  </Button>
                </div>
              </div>
            </div>
          </Banner>
        ) : null}

        {tab === 'answers' ? (
          <div className="mt-8 space-y-10">
            <section className="grid items-center gap-10 border-b border-border/70 pb-10 lg:grid-cols-[minmax(340px,520px)_1fr] lg:gap-16">
              <AuroraCreditCard
                amount={`${headlineAtomicUsdc ?? '—'} USDC`}
                label={t('Total USDC held')}
                handle={profile?.handle ?? account.id}
                wallet={profile?.wallet ? shortKey(profile.wallet) : t('payout wallet not set')}
                verified={Boolean(profile?.walletVerified)}
              />

              <div className="min-w-0">
                <p className="font-mono text-[10px] uppercase tracking-[1.4px] text-muted-foreground">
                  {t('Evidence account')}
                </p>
                <h2 className="mt-3 max-w-xl text-balance text-[28px] font-semibold leading-[1.15] tracking-[-0.035em] sm:text-[34px]">
                  {t('Your answers remain yours. Every qualified reuse is settled here.')}
                </h2>
                <p className="mt-4 max-w-xl text-[15px] leading-7 text-muted-foreground">
                  {t('See what your documents earned, where each payout went, and whether auto-match can reuse them for a new question.')}
                </p>

                <div className="mt-5 flex flex-wrap items-center gap-2">
                  <Button variant="mono" size="monoSm" onClick={() => setTab('questions')}>
                    <ReceiptText className="size-3.5" />
                    {t('Open invoices & receipts')}
                  </Button>
                  {wallet.pubkey ? (
                    <Button
                      variant="monoGhost"
                      size="monoSm"
                      disabled={walletUsdc.loading}
                      onClick={() => void walletUsdc.refresh()}
                      title={walletUsdc.error ?? undefined}
                    >
                      <RefreshCw className={cn('size-3', walletUsdc.loading && 'animate-spin')} />
                      {t('Phantom USDC')} {walletUsdc.amount ?? '—'}
                    </Button>
                  ) : null}
                </div>

                <div className="mt-8 grid grid-cols-2 gap-x-8 gap-y-6 border-y border-border/70 py-6 sm:grid-cols-3">
                  <Stat
                    icon={<Coins className="size-3.5" />}
                    label={t('Settlements')}
                    value={`${earnings?.eventCount ?? settled.length}`}
                    sub={earnings?.heldAtomic && earnings.heldAtomic !== '0' ? `${formatUsdc(earnings.heldAtomic)} USDC${t(' held 14 days')}` : t('No payout is held')}
                  />
                  <Stat
                    icon={<Sparkles className="size-3.5" />}
                    label={t('Auto-match')}
                    value={`${formatUsdcFromKrw(autoEarned)} USDC`}
                    sub={`${total ? Math.round((autoEarned / total) * 100) : 0}%${t(' of your earnings')}`}
                  />
                  <Stat
                    icon={<Flame className="size-3.5" />}
                    label={t('Documents')}
                    value={`${settled.length}`}
                    sub={`${t('across')} ${shelves.length}${t(' topics')}`}
                  />
                </div>

                {balance || profile ? (
                  <div className="divide-y divide-border/60">
                  {balance ? (
                    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 py-3.5 font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">
                      <span>{t('Call credit')} <strong className="text-foreground">{formatUsdc(balance.availableAtomic)} USDC</strong></span>
                      <span>{t('Reserved')} <strong className="text-foreground">{formatUsdc(balance.reservedAtomic)} USDC</strong></span>
                      <span>{t('Held 14 days')} <strong className="text-foreground">{formatUsdc(balance.heldAtomic)} USDC</strong></span>
                      {Number(balance.availableAtomic) > 0 && profile?.walletVerified ? (
                        <Button
                          variant="monoMuted"
                          size="monoSm"
                          className="ml-auto"
                          disabled={withdrawing}
                          onClick={() => void withdrawBalance()}
                        >
                          {withdrawing ? t('Sending…') : t('Send to my wallet')}
                        </Button>
                      ) : null}
                    </div>
                  ) : null}

                  {wallet.pubkey ? (
                    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 py-4 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1.5">
                        <Wallet className="size-3.5" />
                        {t('Phantom wallet balance')}{' '}
                        <strong className="text-foreground">
                          {walletUsdc.loading && walletUsdc.amount === null
                            ? t('Reading…')
                            : `${walletUsdc.amount ?? '—'} USDC`}
                        </strong>
                      </span>
                      <span>{shortKey(wallet.pubkey)} · Devnet</span>
                      <span className="ml-auto">{t('Read from Solana. Not Obulus credit.')}</span>
                    </div>
                  ) : null}

                  {profile ? (
                    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 py-4 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1.5">
                        <Wallet className="size-3.5" />
                        {t('Payouts to')}{' '}
                        {profile.wallet ? (
                          <span className="flex flex-wrap items-center gap-2 text-foreground">
                            {shortKey(profile.wallet)} · {profile.walletVerified ? t('verified') : t('unverified')} · Devnet
                            {!profile.walletVerified ? (
                              <Button
                                variant="monoMuted"
                                size="monoSm"
                                disabled={verifying || wallet.pubkey !== profile.wallet}
                                onClick={() => void verifyOwnership()}
                              >
                                {verifying ? t('Signing…') : t('Prove it is yours')}
                              </Button>
                            ) : null}
                          </span>
                        ) : (
                          <Link
                            to="/onboarding"
                            className="text-foreground underline decoration-dotted underline-offset-4"
                          >
                            {t('payout wallet not set')}
                          </Link>
                        )}
                      </span>
                      <span
                        className={cn(
                          'flex items-center gap-1.5',
                          profile.strikes > 0 && 'text-destructive',
                        )}
                      >
                        <ShieldAlert className="size-3.5" />
                        {profile.strikes}{t(' of ')}{STRIKE_LIMIT}{t(' strikes')}
                      </span>
                      <span className="ml-auto">
                        {profile.disputeUsed ? t('Dispute used') : t('1 dispute left')}
                      </span>
                    </div>
                  ) : null}
                  </div>
                ) : null}
              </div>
            </section>

            {earnings?.claimableKrw ? (
              <Banner tone="teal" className="px-4 py-3 font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">
                {t('Claimable escrow')} <strong className="text-foreground">{formatUsdc(earnings.claimableAtomic)} USDC</strong>
                {' · '}{t('claim it and USDC lands in the wallet recorded at each open. Not part of your prepaid balance.')}
              </Banner>
            ) : null}

            <PrepaidTopUp
              prepaidAtomic={prepaidAtomic}
              onToppedUp={(availableAtomic) => {
                setPrepaidAtomic(availableAtomic)
                void refreshLedger().catch(() => undefined)
              }}
            />


            {walletError ? (
              <p className="text-sm text-destructive">{walletError}</p>
            ) : null}

            {voided.length ? (
              <Banner tone="destructive" className="px-4 py-3">
                <p className="text-sm leading-relaxed text-muted-foreground">
                  <span className="font-medium text-destructive">
                    {voided.length}
                    {voided.length > 1 ? t(' answers voided.') : t(' answer voided.')}
                  </span>{' '}
                  {t('They stay in your personal database so you can review what tripped. Obolus will not quote them, and they earn nothing.')}
                </p>
              </Banner>
            ) : null}

            {/* Auto-match — the line you leave in the water. A hairline-topped
                row rather than a boxed banner, so it flows on from the account
                lines instead of reading as another stacked block. */}
            <div className="flex flex-wrap items-center gap-4 rounded-[18px] bg-muted/45 px-5 py-5">
              <Switch
                checked={autoMatch}
                onCheckedChange={setAutoMatch}
                disabled={(profile?.strikes ?? 0) >= AUTO_MATCH_STRIKE_LIMIT}
                aria-label={t('Auto-match')}
              />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="text-[15px] font-medium">{t('Auto-match')}</span>
                <span className="text-sm leading-relaxed text-muted-foreground">
                  {(profile?.strikes ?? 0) >= AUTO_MATCH_STRIKE_LIMIT
                    ? `${t('Strike')} ${AUTO_MATCH_STRIKE_LIMIT}${t(' of ')}${STRIKE_LIMIT}${t(' — auto-match is off. New payouts are held 14 days. Win the dispute and the strike lifts.')}`
                    : t('Leave it on and Obolus quotes your documents the moment one fits a question — no open call, no waiting. USDC lands in your wallet each time someone opens one, with nothing new written.')}
                </span>
              </div>
            </div>

            {/* Topic spread ------------------------------------------------ */}
            {shelves.length ? (
              <div className="flex flex-wrap gap-1.5">
                {shelves.map(([name, n]) => (
                  <span
                    key={name}
                    className="inline-flex items-center gap-1.5 rounded-[3px] bg-foreground/[0.06] px-2.5 py-1 text-sm"
                  >
                    {name}
                    <Badge>{n}</Badge>
                  </span>
                ))}
              </div>
            ) : null}

            {earnings?.events.length ? (
              <div>
                <div className="flex items-center justify-between gap-4">
                  <p className="font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">
                    {t('Earnings ledger')}
                  </p>
                  <span className="font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">
                    {t('append-only · accrued')}
                  </span>
                </div>
                <ol className="mt-3 divide-y divide-border/70 border-y border-border/70">
                  {earnings.events.slice(0, 6).map((event) => (
                    <li
                      key={event.id}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 py-3"
                    >
                      <span className="font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">
                        {t(event.source.replaceAll('_', ' '))}
                      </span>
                      {event.documentHandle ? (
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {event.documentHandle}
                        </span>
                      ) : null}
                      <span className="text-xs text-muted-foreground">
                        {event.recipientWallet
                          ? `${t('to')} ${shortKey(event.recipientWallet)}`
                          : t('no wallet set at the time')}
                      </span>
                      {event.payoutStatus === 'held' ? (
                        <span className="rounded-[2px] bg-amber-500/10 px-1.5 font-mono text-[9px] uppercase tracking-[1px] text-amber-700">
                          {t('held 14d')}
                        </span>
                      ) : null}
                      {event.payoutStatus === 'onchain' ? (
                        <span className="rounded-[2px] bg-emerald-500/10 px-1.5 font-mono text-[9px] uppercase tracking-[1px] text-emerald-700">
                          {t('paid onchain')}
                        </span>
                      ) : null}
                      {event.payoutStatus === 'claimable' ? (
                        <span className="rounded-[2px] bg-sky-500/10 px-1.5 font-mono text-[9px] uppercase tracking-[1px] text-sky-700">
                          {t(event.payoutClaimStatus ?? 'payout pending')}
                        </span>
                      ) : null}
                      {event.payoutStatus === 'paid' ? (
                        event.payoutTransactionSignature ? (
                          <a
                            href={`https://explorer.solana.com/tx/${event.payoutTransactionSignature}?cluster=devnet`}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded-[2px] bg-emerald-500/10 px-1.5 font-mono text-[9px] uppercase tracking-[1px] text-emerald-700 underline decoration-dotted underline-offset-2"
                          >
                            {t('payout confirmed')}
                          </a>
                        ) : (
                          <span className="rounded-[2px] bg-emerald-500/10 px-1.5 font-mono text-[9px] uppercase tracking-[1px] text-emerald-700">
                            {t('payout confirmed')}
                          </span>
                        )
                      ) : null}
                      <span className="ml-auto font-mono text-xs tabular-nums text-[#0F766E]">
                        +{formatUsdc(event.payoutAmountAtomic ?? event.amountAtomic)} USDC
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}

            {/* Memory stream ----------------------------------------------- */}
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">
                {t('In your personal database')}
              </p>
              {memory.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-3 py-[18vh] text-center">
                  <h2 className="font-sans text-lg font-medium">
                    {t('Nothing in your personal database yet')}
                  </h2>
                  <p className="max-w-[320px] text-sm leading-relaxed text-muted-foreground">
                    {t('Answer one open call and it lands here as a document. Every open after that pays you a little USDC, and we never touch it.')}
                  </p>
                  <Button asChild variant="mono" size="mono" className="mt-2">
                    <Link to="/dashboard">{t('Browse open calls')}</Link>
                  </Button>
                </div>
              ) : (
                <ol className="mt-3 flex flex-col divide-y divide-border/70 border-y border-border/70">
                  {memory.map((m, i) => {
                    const w = weightOf(m.createdAt)
                    const cat = CATEGORY_BY_ID[categoryFor(m.shelf, m.question)]
                    return (
                      <li key={m.id} className="flex gap-4 px-4 py-4">
                        <div className="flex flex-col items-center">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span
                                className="mt-1.5 size-2 shrink-0 cursor-help rounded-full bg-foreground"
                                style={{ opacity: w }}
                              />
                            </TooltipTrigger>
                            <TooltipContent side="right">
                              {t('Weight')} {Math.round(w * 100)}{t('% — recent documents count for more')}
                            </TooltipContent>
                          </Tooltip>
                          {i < memory.length - 1 ? (
                            <span className="w-px flex-1 bg-border" />
                          ) : null}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <CategoryIcon
                              id={categoryFor(m.shelf, m.question)}
                              className="size-3 shrink-0 opacity-70"
                              style={{ color: cat?.accent ?? 'var(--muted-foreground)' }}
                            />
                            <span className="font-mono text-[11px] uppercase tracking-[1px] text-muted-foreground">
                              {m.shelf}
                            </span>
                            <span
                              className={cn(
                                'rounded-[2px] px-1.5 py-0 font-mono text-[10px] uppercase tracking-[1px]',
                                m.via === 'Auto-match'
                                  ? 'bg-[#0F766E]/10 text-[#0F766E]'
                                  : 'bg-foreground/10 text-foreground',
                              )}
                            >
                              {t(m.via)}
                            </span>
                            {m.rating ? (
                              <span className="flex items-center gap-0.5 font-mono text-[10px] tabular-nums text-muted-foreground">
                                <Star className="size-3 fill-current" />
                                {m.rating}.0
                              </span>
                            ) : null}
                            <span
                              className={cn(
                                'ml-auto font-mono text-sm font-semibold tabular-nums',
                                m.status === 'voided'
                                  ? 'text-muted-foreground/60 line-through'
                                  : 'text-[#0F766E]',
                              )}
                            >
                              +{formatUsdcFromKrw(m.earned)} USDC
                            </span>
                            {m.status !== 'voided' &&
                            m.memoryType !== 'reflection' &&
                            m.memoryType !== 'reuse' ? (
                              <button
                                type="button"
                                disabled={lockingId === m.id}
                                onClick={() => void toggleMemoryLock(m.id, !m.locked)}
                                className="inline-flex size-6 cursor-pointer items-center justify-center rounded border border-border text-muted-foreground hover:text-foreground disabled:cursor-wait"
                                title={m.locked ? t('Unlock it so Obolus can quote it') : t('Lock it so Obolus stops quoting it')}
                                aria-label={m.locked ? t('Unlock document') : t('Lock document')}
                              >
                                {lockingId === m.id ? (
                                  <Loader2 className="size-3 animate-spin" />
                                ) : m.locked ? (
                                  <Lock className="size-3" />
                                ) : (
                                  <Unlock className="size-3" />
                                )}
                              </button>
                            ) : null}
                          </div>
                          <p className="mt-1.5 text-sm text-muted-foreground">
                            {m.question}
                          </p>
                          <p
                            className={cn(
                              'mt-1 text-[15px] leading-relaxed',
                              m.status === 'voided'
                                ? 'text-foreground/50'
                                : 'text-foreground/90',
                            )}
                          >
                            {m.answer}
                          </p>

                          {m.interviewResponses?.length ? (
                            <details className="mt-3 rounded-[4px] border border-border/70 bg-muted/25 px-3 py-2">
                              <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">
                                {t('Interview context')} · {m.interviewResponses.length}{t(' turns · private')}
                              </summary>
                              <ol className="mt-3 space-y-3">
                                {m.interviewResponses.map((response) => (
                                  <li key={response.questionId}>
                                    <p className="text-xs text-muted-foreground">
                                      {response.prompt}
                                    </p>
                                    <p className="mt-0.5 text-sm text-foreground/85">
                                      {response.answer}
                                    </p>
                                  </li>
                                ))}
                              </ol>
                            </details>
                          ) : null}

                          {m.status === 'voided' ? (
                            <div className="mt-3 rounded-[4px] border border-destructive/25 bg-destructive/[0.04] p-3">
                              <p className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[1px] text-destructive">
                                <ShieldAlert className="size-3" />
                                {t('Voided')} · {t(m.flags?.[0]?.rule ?? 'Low-effort answers')}
                              </p>
                              {m.flags?.map((f) => (
                                <p
                                  key={f.detail}
                                  className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground"
                                >
                                  {t(f.detail)}
                                </p>
                              ))}
                              <div className="mt-3 flex items-center gap-3">
                                <Button
                                  variant="monoMuted"
                                  size="monoSm"
                                  disabled={profile?.disputeUsed || Boolean(disputingId) || m.disputeStatus === 'pending'}
                                  onClick={() => setDraftDisputeId(m.id)}
                                >
                                  {disputingId === m.id ? (
                                    <Loader2 className="size-3 animate-spin" />
                                  ) : m.disputeStatus === 'pending' ? (
                                    t('Review pending')
                                  ) : profile?.disputeUsed ? (
                                    t('Dispute used')
                                  ) : (
                                    t('Dispute this')
                                  )}
                                </Button>
                                <span className="font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">
                                  {t('One per wallet')}
                                </span>
                              </div>
                              {draftDisputeId === m.id ? (
                                <div className="mt-3 grid gap-2">
                                  <textarea
                                    value={disputeReason}
                                    onChange={(event) => setDisputeReason(event.target.value)}
                                    rows={3}
                                    maxLength={1000}
                                    placeholder={t('Say what the check got wrong. 20 characters minimum.')}
                                    className="w-full resize-y rounded-[3px] border border-border bg-background p-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-foreground/30"
                                  />
                                  <div className="flex gap-2">
                                    <Button
                                      variant="mono"
                                      size="monoSm"
                                      disabled={disputeReason.trim().length < 20}
                                      onClick={() => void dispute(m.id)}
                                    >
                                      {t('Send for review')}
                                    </Button>
                                    <Button
                                      variant="monoGhost"
                                      size="monoSm"
                                      onClick={() => setDraftDisputeId(null)}
                                    >
                                      {t('Cancel')}
                                    </Button>
                                  </div>
                                </div>
                              ) : null}
                              {disputeError ? (
                                <p className="mt-2 text-[13px] text-destructive">
                                  {disputeError}
                                </p>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      </li>
                    )
                  })}
                </ol>
              )}
            </div>

            <section className="border-t border-border/70 pt-6">
              <h3 className="text-[15px] font-medium text-foreground">
                {t('Delete account and data')}
              </h3>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                {t('Deleting refunds unused open-call escrow to your wallet, removes your profile and every document, and signs out every session. The financial audit rows stay, with your handle stripped.')}
              </p>
              <div className="mt-4 flex items-center gap-2">
                {deleteConfirm ? (
                  <>
                    <Button
                      variant="destructive"
                      size="monoSm"
                      disabled={deleting}
                      onClick={() => {
                        setDeleting(true)
                        void deleteCurrentAccount()
                          .then(() => navigate('/', { replace: true }))
                          .finally(() => setDeleting(false))
                      }}
                    >
                      {deleting ? <Loader2 className="size-3 animate-spin" /> : t('Permanently delete')}
                    </Button>
                    <Button variant="monoGhost" size="monoSm" onClick={() => setDeleteConfirm(false)}>
                      {t('Keep it')}
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="ghost"
                    size="monoSm"
                    className="px-0 text-destructive hover:bg-transparent hover:text-destructive/75"
                    onClick={() => setDeleteConfirm(true)}
                  >
                    <Trash2 className="size-3" /> {t('Delete everything')}
                  </Button>
                )}
              </div>
            </section>
          </div>
        ) : null}

        {tab === 'questions' ? <ArchivePanel /> : null}

        {tab === 'transactions' ? <TransactionsPanel /> : null}
      </div>
    </div>
  )
}

function MemoryTab({
  active,
  children,
  onClick,
}: {
  active: boolean
  children: React.ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'relative cursor-pointer pb-3 text-sm text-muted-foreground transition-colors hover:text-foreground',
        active &&
          'font-medium text-foreground after:absolute after:inset-x-0 after:-bottom-px after:h-px after:bg-foreground',
      )}
    >
      {children}
    </button>
  )
}

/**
 * 충전하기 — top up the USDC prepaid pot in whole-USDC steps. The button drives
 * the public standalone rail: prepare a top-up on the payment gateway, sign the
 * exact USDC transfer to BUNDLE_RECEIVER with Phantom, and the gateway credits
 * the prepaid balance through the internal deposit route only after it confirms
 * the transfer on-chain. The low-balance prompt keys off the prepaid balance.
 */
function PrepaidTopUp({
  prepaidAtomic,
  onToppedUp,
}: {
  prepaidAtomic: string | null
  onToppedUp: (availableAtomic: string) => void
}) {
  const t = useT()
  const [amount, setAmount] = useState<number>(5)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const known = prepaidAtomic != null
  const low = known && Number(prepaidAtomic) < LOW_BALANCE_ATOMIC
  const balanceLabel = known ? `${formatUsdcShort(prepaidAtomic) ?? '0.00'} USDC` : '—'

  const submit = async () => {
    if (busy || amount < 1) return
    setBusy(true)
    setError(null)
    try {
      const { topUpPrepaid } = await import('@/lib/x402')
      const { availableAtomic } = await topUpPrepaid(amount)
      onToppedUp(availableAtomic)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="overflow-hidden rounded-[6px] border border-border/70 bg-card">
      {low ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-border/60 bg-amber-500/[0.06] px-4 py-2.5">
          <span className="font-mono text-[10px] uppercase tracking-[1px] text-amber-700">
            {t('Top up your balance?')}
          </span>
          <span className="text-xs text-muted-foreground">
            {t('Your prepaid USDC is running low. Add funds so opens and Pay.sh settlements never stall.')}
          </span>
        </div>
      ) : null}
      <div className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">
            <Wallet className="size-3.5" />
            {t('Top up prepaid USDC')}
          </span>
          <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
            {t('Prepaid balance')} <strong className="text-foreground">{balanceLabel}</strong>
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {TOP_UP_STEPS_USDC.map((step) => (
            <Chip key={step} active={amount === step} onClick={() => setAmount(step)}>
              {step} USDC
            </Chip>
          ))}
          <Button
            variant="mono"
            size="monoSm"
            className="ml-auto"
            disabled={busy || amount < 1}
            aria-label={t('Top up')}
            onClick={submit}
          >
            <Plus className="size-3" />
            {busy ? t('Topping up…') : `${t('Top up')} · ${amount} USDC`}
          </Button>
        </div>
        {error ? (
          <p className="text-xs leading-relaxed text-destructive">{error}</p>
        ) : null}
      </div>
    </div>
  )
}

function Stat({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode
  label: string
  value: string
  sub: string
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-2 font-host text-[26px] font-medium leading-none tabular-nums">
        {value}
      </div>
      <div className="mt-1.5 text-xs text-muted-foreground">{sub}</div>
    </div>
  )
}
