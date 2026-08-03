import { useEffect, useMemo, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  CornerDownLeft,
  Dice5,
  ExternalLink,
  Loader2,
  ShieldAlert,
  Wallet,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CATEGORIES, type CategoryId } from '@/data/categories'
import {
  AGE_BANDS,
  CONDUCT_SUMMARY,
  HOUSEHOLDS,
  REGIONS,
  STRIKE_LADDER,
  STRIKE_LIMIT,
  STRIKE_RULES,
  YEAR_BANDS,
  suggestHandle,
  type Option,
} from '@/data/onboarding'
import { cn } from '@/lib/utils'
import { useUi } from '@/state/ui'
import {
  DEVNET_FAUCETS,
  PHANTOM_INSTALL_URL,
  shortKey,
  useWallet,
} from '@/state/wallet'

/**
 * Onboarding — six screens, in the same one-question-at-a-time register as the
 * answer flow, because it is the same act: telling us something about yourself.
 *
 * The first four exist so a buyer can tell whether the person behind a passage
 * was actually in the situation. Then the payout address. The last is the
 * conduct ladder, shown before anyone answers anything rather than buried in the
 * terms page — a strike system nobody read is not a deterrent, it is an ambush.
 */
export default function Onboarding() {
  const navigate = useNavigate()
  const { saveProfile, profile, account, authReady } = useUi()
  const wallet = useWallet()

  const [step, setStep] = useState(0)
  const [handle, setHandle] = useState(() => profile?.handle ?? suggestHandle())
  const [ageBand, setAgeBand] = useState(profile?.ageBand ?? '')
  const [region, setRegion] = useState(profile?.region ?? '')
  const [household, setHousehold] = useState(profile?.household ?? '')
  const [field, setField] = useState<CategoryId | ''>(profile?.field ?? '')
  const [years, setYears] = useState(profile?.years ?? '')
  const [speaksTo, setSpeaksTo] = useState<CategoryId[]>(profile?.speaksTo ?? [])
  const [payoutWallet, setPayoutWallet] = useState(profile?.wallet ?? '')
  const [agreed, setAgreed] = useState(false)
  const [done, setDone] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const TOTAL = 6

  const canAdvance = useMemo(() => {
    if (step === 0) return handle.trim().length >= 3
    if (step === 1) return Boolean(ageBand && region && household)
    if (step === 2) return Boolean(field && years)
    if (step === 3) return speaksTo.length > 0
    // The wallet step is skippable — a payout address can wait, and blocking
    // onboarding on a browser extension loses people who would have answered.
    if (step === 4) return true
    return agreed
  }, [step, handle, ageBand, region, household, field, years, speaksTo, agreed])

  /** Picking your own line of work pre-selects it as a field you can answer in. */
  const chooseField = (id: CategoryId) => {
    setField(id)
    setSpeaksTo((prev) => (prev.includes(id) ? prev : [...prev, id]))
  }

  const toggleSpeaks = (id: CategoryId) =>
    setSpeaksTo((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )

  const finish = async () => {
    if (!field || saving) return
    setSaving(true)
    setSaveError(null)
    try {
      await saveProfile({
        handle: handle.trim().toUpperCase(),
        ageBand,
        region,
        household,
        field,
        years,
        speaksTo,
        wallet: payoutWallet || undefined,
      })
      setDone(true)
      window.setTimeout(() => navigate('/dashboard'), 1400)
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : 'The profile did not save. Try again.',
      )
    } finally {
      setSaving(false)
    }
  }

  const next = () => {
    if (!canAdvance) return
    if (step === TOTAL - 1) void finish()
    else setStep((s) => s + 1)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter') return
      const el = e.target as HTMLElement | null
      if (el?.tagName === 'TEXTAREA') return
      e.preventDefault()
      next()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!authReady) {
    return <div className="flex flex-1 items-center justify-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
  }
  if (!account) return <Navigate to="/login" replace />

  if (done) {
    return (
      <div className="flex flex-1 items-center justify-center px-6">
        <div className="flex max-w-md flex-col items-center gap-4 text-center">
          <span className="flex size-11 items-center justify-center rounded-full bg-[#0F766E]/12">
            <Check className="size-5 text-[#0F766E]" />
          </span>
          <h1 className="font-display text-2xl font-medium">
            You are {handle.trim().toUpperCase()}
          </h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Open calls in your fields show up first. An asker sees your handle
            and these bands, nothing else — the passage only after they pay to
            open it.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="page-enter flex flex-1 flex-col overflow-y-auto">
      {/* progress ------------------------------------------------------- */}
      <div className="sticky top-0 z-10 bg-background/85 backdrop-blur">
        <div className="h-0.5 w-full bg-foreground/[0.07]">
          <div
            className="h-full bg-foreground/70 transition-[width] duration-500"
            style={{ width: `${((step + 1) / TOTAL) * 100}%` }}
          />
        </div>
        <div className="flex items-center justify-between px-4 py-2.5 font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground sm:px-6">
          <span>Before you answer</span>
          <span className="tabular-nums">
            {step + 1} / {TOTAL}
          </span>
        </div>
      </div>

      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-4 py-10 sm:px-6">
        <div key={step} className="page-enter">
          <span className="font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">
            {String(step).padStart(2, '0')}
          </span>

          {step === 0 ? (
            <Screen
              title="Pick a handle"
              note="This is the whole identity an asker sees beside your passage. No name, no email, no photo — ever."
            >
              <div className="flex items-center gap-2">
                <input
                  value={handle}
                  onChange={(e) => setHandle(e.target.value)}
                  spellCheck={false}
                  className="h-11 w-full max-w-xs rounded-[2px] border border-border bg-transparent px-3 font-mono text-sm uppercase tracking-[1px] outline-none transition-colors focus:border-foreground/40"
                />
                <Button
                  variant="monoMuted"
                  size="mono"
                  onClick={() => setHandle(suggestHandle())}
                  type="button"
                >
                  <Dice5 className="size-3.5" />
                  Shuffle
                </Button>
              </div>
            </Screen>
          ) : null}

          {step === 1 ? (
            <Screen
              title="Three bands about you"
              note="Bands, not exact numbers. Enough for an asker to tell whether an answer came from someone in that situation."
            >
              <Group label="Age">
                <Chips options={AGE_BANDS} value={ageBand} onPick={setAgeBand} />
              </Group>
              <Group label="Where you live">
                <Chips options={REGIONS} value={region} onPick={setRegion} />
              </Group>
              <Group label="Household">
                <Chips
                  options={HOUSEHOLDS}
                  value={household}
                  onPick={setHousehold}
                />
              </Group>
            </Screen>
          ) : null}

          {step === 2 ? (
            <Screen
              title="What do you do?"
              note="Your own line of work. Open calls in this field reach you first."
            >
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {CATEGORIES.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => chooseField(c.id)}
                    className={cn(
                      'flex cursor-pointer items-center gap-2 rounded-[4px] border px-3 py-2.5 text-left text-sm transition-all',
                      field === c.id
                        ? 'border-foreground/40 bg-foreground/[0.05] font-medium'
                        : 'border-border hover:border-foreground/20 hover:bg-foreground/[0.02]',
                    )}
                  >
                    <c.Icon
                      className="size-4 shrink-0"
                      style={{ color: c.accent }}
                    />
                    {c.label}
                  </button>
                ))}
              </div>
              <Group label="How long">
                <Chips options={YEAR_BANDS} value={years} onPick={setYears} />
              </Group>
            </Screen>
          ) : null}

          {step === 3 ? (
            <Screen
              title="What can you answer?"
              note="Pick anything you have actually lived through, not only your job. These decide which open calls reach you first."
            >
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {CATEGORIES.map((c) => {
                  const on = speaksTo.includes(c.id)
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => toggleSpeaks(c.id)}
                      className={cn(
                        'flex cursor-pointer items-start gap-3 rounded-[4px] border p-3 text-left transition-all',
                        on
                          ? 'border-foreground/40 bg-foreground/[0.05]'
                          : 'border-border hover:border-foreground/20 hover:bg-foreground/[0.02]',
                      )}
                    >
                      <span
                        className={cn(
                          'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-[2px] border transition-colors',
                          on
                            ? 'border-foreground bg-foreground text-background'
                            : 'border-foreground/25',
                        )}
                      >
                        {on ? <Check className="size-3" /> : null}
                      </span>
                      <span className="min-w-0">
                        <span className="flex items-center gap-1.5 text-sm font-medium">
                          <c.Icon
                            className="size-3.5"
                            style={{ color: c.accent }}
                          />
                          {c.label}
                        </span>
                        <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                          {c.blurb}
                        </span>
                      </span>
                    </button>
                  )
                })}
              </div>
            </Screen>
          ) : null}

          {step === 4 ? (
            <Screen
              title="Where the money lands"
              note="USDC lands in the wallet you name here, over x402 on Solana devnet. Save one now, verify ownership later, or skip this screen. This site connects Phantom; an outside agent can link its own locally held Pay account over SIWX."
            >
              {wallet.pubkey ? (
                <div className="space-y-3 rounded-[6px] border border-border p-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="size-2 shrink-0 rounded-full bg-[#0F766E]" />
                    <span className="font-mono text-sm">
                      Browser wallet · {shortKey(wallet.pubkey)}
                    </span>
                    <span className="font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">
                      devnet
                    </span>
                  </div>
                  <p className="text-[13px] leading-relaxed text-muted-foreground">
                    Connecting the extension does not set a payout address. Tell us
                    whether your earnings should land in this wallet.
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant={payoutWallet === wallet.pubkey ? 'mono' : 'monoMuted'}
                      size="monoSm"
                      onClick={() => setPayoutWallet(wallet.pubkey ?? '')}
                      type="button"
                    >
                      {payoutWallet === wallet.pubkey ? (
                        <Check className="size-3.5" />
                      ) : (
                        <Wallet className="size-3.5" />
                      )}
                      {payoutWallet === wallet.pubkey
                        ? 'Payouts land here'
                        : 'Use for payouts'}
                    </Button>
                    <Button
                      variant="monoGhost"
                      size="monoSm"
                      onClick={() => setPayoutWallet('')}
                      type="button"
                    >
                      Skip for now
                    </Button>
                  </div>
                  {payoutWallet && payoutWallet !== wallet.pubkey ? (
                    <p className="font-mono text-[11px] text-muted-foreground">
                      Existing payout address kept · {shortKey(payoutWallet)}
                    </p>
                  ) : null}
                </div>
              ) : (
                <div className="rounded-[6px] border border-border p-4">
                  {wallet.available ? (
                    <Button
                      variant="mono"
                      size="mono"
                      disabled={wallet.connecting}
                      onClick={() => void wallet.connect()}
                      type="button"
                    >
                      <Wallet className="size-3.5" />
                      {wallet.connecting ? 'Connecting…' : 'Connect browser wallet'}
                    </Button>
                  ) : (
                    <a
                      href={PHANTOM_INSTALL_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex h-9 items-center gap-2 rounded-[2px] bg-foreground px-3 font-mono text-xs uppercase tracking-[1px] text-background transition-colors hover:bg-foreground/85"
                    >
                      <Wallet className="size-3.5" />
                      Install Phantom
                      <ExternalLink className="size-3" />
                    </a>
                  )}
                  {wallet.error ? (
                    <p className="mt-3 text-sm text-destructive">
                      {wallet.error}
                    </p>
                  ) : null}
                  <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
                    Nothing is signed here — only the public key is read. You verify
                    ownership later with one signMessage. A fresh devnet wallet has no
                    SOL for fees and no USDC to settle with:{' '}
                    <a
                      href={DEVNET_FAUCETS.sol}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline decoration-dotted underline-offset-4 hover:text-foreground"
                    >
                      SOL faucet
                    </a>
                    ,{' '}
                    <a
                      href={DEVNET_FAUCETS.usdc}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline decoration-dotted underline-offset-4 hover:text-foreground"
                    >
                      USDC faucet
                    </a>
                    .
                  </p>
                </div>
              )}
            </Screen>
          ) : null}

          {step === 5 ? (
            <Screen
              title="Three strikes and the account stops"
              note={CONDUCT_SUMMARY}
            >
              <div className="rounded-[6px] border border-destructive/25 bg-destructive/[0.04] p-5">
                <p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[1px] text-destructive">
                  <ShieldAlert className="size-3.5" />
                  What earns a strike
                </p>
                <ul className="mt-4 space-y-4">
                  {STRIKE_RULES.map((r) => (
                    <li key={r.title} className="flex gap-3">
                      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
                      <div>
                        <p className="text-sm font-medium">{r.title}</p>
                        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                          {r.body}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="mt-4 overflow-hidden rounded-[6px] border border-border">
                {STRIKE_LADDER.map((s) => (
                  <div
                    key={s.n}
                    className="flex gap-4 border-b border-border/60 px-4 py-3.5 last:border-0"
                  >
                    <span
                      className={cn(
                        'flex size-6 shrink-0 items-center justify-center rounded-full font-mono text-[11px] tabular-nums',
                        s.n === STRIKE_LIMIT
                          ? 'bg-destructive text-white'
                          : 'bg-foreground/[0.07] text-muted-foreground',
                      )}
                    >
                      {s.n}
                    </span>
                    <div>
                      <p
                        className={cn(
                          'font-mono text-[11px] uppercase tracking-[1px]',
                          s.n === STRIKE_LIMIT
                            ? 'text-destructive'
                            : 'text-foreground',
                        )}
                      >
                        {s.title}
                      </p>
                      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                        {s.body}
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={() => setAgreed((v) => !v)}
                className="mt-5 flex w-full cursor-pointer items-start gap-3 rounded-[4px] border border-border p-4 text-left transition-colors hover:bg-foreground/[0.02]"
              >
                <span
                  className={cn(
                    'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-[2px] border transition-colors',
                    agreed
                      ? 'border-foreground bg-foreground text-background'
                      : 'border-foreground/25',
                  )}
                >
                  {agreed ? <Check className="size-3" /> : null}
                </span>
                <span className="text-sm leading-relaxed">
                  I have read the three rules above. I will only answer about
                  things I have actually lived, and I accept that three confirmed
                  strikes suspends the account.
                </span>
              </button>
            </Screen>
          ) : null}
        </div>

        {/* controls ----------------------------------------------------- */}
        <div className="mt-10 flex items-center gap-3">
          {step > 0 ? (
            <Button
              variant="monoGhost"
              size="mono"
              onClick={() => setStep((s) => s - 1)}
              type="button"
            >
              <ArrowLeft className="size-3.5" />
              Back
            </Button>
          ) : null}
          <Button
            variant="mono"
            size="mono"
            className="ml-auto"
            disabled={!canAdvance || saving}
            onClick={next}
            type="button"
          >
            {saving ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <ArrowRight className="size-3.5" />
            )}
            {saving
              ? 'Saving…'
              : step === TOTAL - 1
                ? 'Agree and finish'
                : 'Continue'}
          </Button>
          <span className="hidden items-center gap-1 font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground sm:flex">
            <CornerDownLeft className="size-3" />
            Enter
          </span>
        </div>
        {saveError ? (
          <p className="mt-3 text-right text-sm text-destructive">{saveError}</p>
        ) : null}
      </div>
    </div>
  )
}

function Screen({
  title,
  note,
  children,
}: {
  title: string
  note: string
  children: React.ReactNode
}) {
  return (
    <>
      <h1 className="mt-2 font-display text-[26px] leading-tight font-medium sm:text-3xl">
        {title}
      </h1>
      <p className="mt-3 max-w-xl text-[15px] leading-7 text-muted-foreground">
        {note}
      </p>
      <div className="mt-7 space-y-6">{children}</div>
    </>
  )
}

function Group({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">
        {label}
      </p>
      <div className="mt-2">{children}</div>
    </div>
  )
}

function Chips({
  options,
  value,
  onPick,
}: {
  options: Option[]
  value: string
  onPick: (v: string) => void
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onPick(o.value)}
          className={cn(
            'h-9 cursor-pointer rounded-[2px] border px-3 text-sm transition-all',
            value === o.value
              ? 'border-foreground/40 bg-foreground/[0.06] font-medium'
              : 'border-border text-muted-foreground hover:border-foreground/20 hover:text-foreground',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
