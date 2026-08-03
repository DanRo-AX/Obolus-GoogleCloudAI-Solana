import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CornerDownLeft,
  Loader2,
  ShieldAlert,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CATEGORY_BY_ID } from '@/data/categories'
import { AGE_BANDS, HOUSEHOLDS, REGIONS } from '@/data/onboarding'
import { AUTO_MATCH_STRIKE_LIMIT, STRIKE_LIMIT } from '@/data/onboarding'
import { MAIN_GUIDANCE, warmupsFor, type Warmup } from '@/data/survey'
import { useT } from '@/i18n'
import { assess, type Issue } from '@/lib/quality'
import {
  BACKEND_ENABLED,
  beaconReleaseOpenCallReservation,
  releaseOpenCallReservation,
  reserveOpenCall,
} from '@/lib/api'
import { cn } from '@/lib/utils'
import { useUi } from '@/state/ui'

/**
 * One screen per question, the way a good survey does it. Four light warm-ups
 * first — they set the register for the answer that actually pays — then the
 * open call itself.
 *
 * Enter advances. Nothing here is required except the last screen.
 */
export default function Survey() {
  const { orderId } = useParams()
  const navigate = useNavigate()
  const { orders, answerOrder, profile, suspended, authReady } = useUi()
  const t = useT()
  const order = orders.find((o) => o.id === orderId)

  const warmups = useMemo(() => warmupsFor(order?.shelf ?? ''), [order?.shelf])
  const total = warmups.length + 1

  const [step, setStep] = useState(0)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [main, setMain] = useState('')
  const [done, setDone] = useState(false)
  /** Set when the check flagged the draft and the person saw the warning. */
  const [flags, setFlags] = useState<Issue[] | null>(null)
  const [struck, setStruck] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [reservationExpiresAt, setReservationExpiresAt] = useState<number | null>(null)
  const [reservationError, setReservationError] = useState<string | null>(null)
  const submittedRef = useRef(false)
  const mainRef = useRef<HTMLTextAreaElement>(null)

  const onLast = step === warmups.length
  const current = warmups[step]

  useEffect(() => {
    if (onLast) mainRef.current?.focus()
  }, [onLast])

  useEffect(() => {
    if (!BACKEND_ENABLED || !orderId || !profile || suspended) return
    let cancelled = false
    const hold = async () => {
      try {
        const reservation = await reserveOpenCall(orderId)
        if (!cancelled) {
          setReservationExpiresAt(reservation.expiresAt)
          setReservationError(null)
        }
      } catch (error) {
        if (!cancelled) {
          setReservationError(
            error instanceof Error
              ? error.message
              : t('This call had no slot left to hold.'),
          )
        }
      }
    }
    void hold()
    const interval = window.setInterval(() => void hold(), 60_000)
    const releaseOnPageHide = () => {
      if (!submittedRef.current) beaconReleaseOpenCallReservation(orderId)
    }
    window.addEventListener('pagehide', releaseOnPageHide)
    return () => {
      cancelled = true
      window.clearInterval(interval)
      window.removeEventListener('pagehide', releaseOnPageHide)
      if (!submittedRef.current) {
        void releaseOpenCallReservation(orderId).catch(() => undefined)
      }
    }
  }, [orderId, profile, suspended])

  if (!authReady) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 size-4 animate-spin" />
        {t('Opening the call…')}
      </div>
    )
  }
  if (!order) return <Navigate to="/dashboard" replace />
  if (!profile) return <Navigate to="/onboarding" replace />
  if (suspended) return <Navigate to="/dashboard" replace />

  const advance = () => setStep((s) => Math.min(total - 1, s + 1))
  const back = () => setStep((s) => Math.max(0, s - 1))
  const set = (id: string, v: string) =>
    setAnswers((a) => ({ ...a, [id]: v }))

  /**
   * Check before sending. First press only warns — a person who is sure their
   * answer is fine can press again, and that is what the dispute exists for.
   */
  const submit = async () => {
    const text = main.trim()
    if (!text || submitting) return
    const issues = assess(order.question, text)
    if (issues.length && !flags) {
      setFlags(issues)
      return
    }
    setSubmitting(true)
    setSubmitError(null)
    try {
      const interviewResponses = warmups.flatMap((warmup) => {
        const answer = answers[warmup.id]?.trim()
        return answer
          ? [{ questionId: warmup.id, prompt: warmup.prompt, answer }]
          : []
      })
      const result = await answerOrder(
        order.id,
        text,
        issues.length ? issues : undefined,
        interviewResponses,
      )
      submittedRef.current = true
      setFlags(result.issues.length ? result.issues : null)
      setStruck(result.voided)
      setDone(true)
    } catch (error) {
      setSubmitError(
        error instanceof Error
          ? error.message
          : t('The answer did not save. Send it again.'),
      )
    } finally {
      setSubmitting(false)
    }
  }

  if (done && struck) {
    return (
      <div className="flex flex-1 items-center justify-center px-6">
        <div className="flex max-w-md flex-col items-center gap-4 text-center">
          <span className="flex size-11 items-center justify-center rounded-full bg-destructive/12">
            <ShieldAlert className="size-5 text-destructive" />
          </span>
          <h1 className="font-display text-2xl font-medium">
            {t('Strike issued — the answer was voided')}
          </h1>
          <p className="text-[15px] leading-7 text-muted-foreground">
            {t('The')} ₩{order.unitPrice.toLocaleString()}
            {t(
              ' was reversed and the slot stayed open. It sits on your shelf marked voided —',
            )}{' '}
            {STRIKE_LIMIT}
            {t(
              ' strikes suspends the account. You can dispute this once, from there.',
            )}
          </p>
          <div className="mt-2 flex gap-2">
            <Button variant="mono" size="mono" onClick={() => navigate('/memory')}>
              {t('See the strike')}
            </Button>
            <Button
              variant="monoMuted"
              size="mono"
              onClick={() => navigate('/dashboard')}
            >
              {t('Back to calls')}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  if (done) {
    const held = profile.strikes >= AUTO_MATCH_STRIKE_LIMIT
    return (
      <div className="flex flex-1 items-center justify-center px-6">
        <div className="flex max-w-md flex-col items-center gap-4 text-center">
          <span className="flex size-11 items-center justify-center rounded-full bg-[#0F766E]/12">
            <Check className="size-5 text-[#0F766E]" />
          </span>
          <h1 className="font-display text-2xl font-medium">
            ₩{order.unitPrice.toLocaleString()}
            {held ? t(' accrued · held 14 days') : t(' is yours')}
          </h1>
          <p className="text-[15px] leading-7 text-muted-foreground">
            {held
              ? t(
                  'The answer is on your shelf. At strike 2 of 3 auto-match pauses, so this payout is held 14 days before it moves.',
                )
              : t(
                  'It sits on your shelf now. SHELF can quote it without you writing anything again — each open lands USDC in your wallet.',
                )}
          </p>
          <div className="mt-2 flex gap-2">
            <Button variant="mono" size="mono" onClick={() => navigate('/memory')}>
              {t('See my shelf')}
            </Button>
            <Button
              variant="monoMuted"
              size="mono"
              onClick={() => navigate('/dashboard')}
            >
              {t('Next open call')}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      className="flex flex-1 flex-col"
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey && !onLast) {
          e.preventDefault()
          advance()
        }
      }}
    >
      {/* progress + exit ------------------------------------------------- */}
      <div className="flex items-center gap-4 px-4 pt-4 sm:px-8 sm:pt-6">
        <div className="flex flex-1 gap-1">
          {Array.from({ length: total }, (_, i) => (
            <span
              key={i}
              className={cn(
                'h-0.5 flex-1 rounded-full transition-colors duration-300',
                i < step
                  ? 'bg-[#0F766E]'
                  : i === step
                    ? 'bg-foreground'
                    : 'bg-foreground/12',
              )}
            />
          ))}
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">
          {step + 1}/{total}
          {reservationExpiresAt ? t(' · slot held 10 min') : ''}
        </span>
        <button
          type="button"
          aria-label={t('Leave')}
          onClick={() => navigate('/dashboard')}
          className="cursor-pointer text-muted-foreground transition-colors hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="flex flex-1 items-center justify-center px-6 py-10">
        <div key={step} className="animate-fade-in-up w-full max-w-xl">
          {reservationError ? (
            <div className="mb-6 rounded-[6px] border border-destructive/30 bg-destructive/[0.04] p-4 text-sm text-destructive">
              {reservationError}{' '}
              {t('Go back to open calls and take a different one.')}
            </div>
          ) : null}
          {onLast ? (
            <MainQuestion
              order={order}
              value={main}
              onChange={(v: string) => {
                setMain(v)
                if (flags) setFlags(null)
              }}
              inputRef={mainRef}
            />
          ) : (
            <WarmupQuestion
              n={step + 1}
              warmup={current}
              value={answers[current.id] ?? ''}
              onChange={(v) => set(current.id, v)}
              onPick={() => window.setTimeout(advance, 180)}
            />
          )}

          {onLast && flags ? (
            <div className="mt-6 rounded-[6px] border border-destructive/30 bg-destructive/[0.04] p-4">
              <p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[1px] text-destructive">
                <ShieldAlert className="size-3.5" />
                {t('This would be flagged')} · {t(flags[0].rule)}
              </p>
              <ul className="mt-3 space-y-2">
                {flags.map((f) => (
                  <li
                    key={f.detail}
                    className="text-[13px] leading-relaxed text-muted-foreground"
                  >
                    {t(f.detail)}
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-[13px] leading-relaxed text-foreground/85">
                {t('Send it as it stands and the answer is voided, the')}{' '}
                ₩{order.unitPrice.toLocaleString()}
                {t(' reversed, and it counts as one of your')} {STRIKE_LIMIT}
                {t(' strikes. Editing it clears this.')}
              </p>
            </div>
          ) : null}

          {submitError ? (
            <p className="mt-4 text-sm text-destructive">{submitError}</p>
          ) : null}

          <div className="mt-10 flex items-center gap-3">
            {step > 0 ? (
              <Button variant="monoGhost" size="mono" onClick={back}>
                <ArrowLeft className="size-3.5" />
                {t('Back')}
              </Button>
            ) : null}

            {onLast ? (
              <Button
                variant="mono"
                size="monoLg"
                disabled={!main.trim() || submitting || Boolean(reservationError)}
                onClick={() => void submit()}
                className={cn(flags && 'bg-destructive hover:bg-destructive/90')}
              >
                {submitting ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" />
                    {t('Sending…')}
                  </>
                ) : flags ? (
                  t('Send it anyway')
                ) : (
                  <>
                    {t('Send and take')} ₩{order.unitPrice.toLocaleString()}
                  </>
                )}
              </Button>
            ) : (
              <Button variant="monoMuted" size="mono" onClick={advance}>
                {answers[current.id] ? t('Next') : t('Skip')}
                <ArrowRight className="size-3.5" />
              </Button>
            )}

            {!onLast ? (
              <span className="ml-auto hidden items-center gap-1.5 font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground sm:flex">
                <CornerDownLeft className="size-3" />
                Enter
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}

/* --------------------------------------------------------------- screens */

function WarmupQuestion({
  n,
  warmup,
  value,
  onChange,
  onPick,
}: {
  n: number
  warmup: Warmup
  value: string
  onChange: (v: string) => void
  onPick: () => void
}) {
  const t = useT()
  return (
    <div>
      <span className="font-mono text-[10px] uppercase tracking-[1.5px] text-muted-foreground">
        {t('Warm-up')} {n} {t('· one second each')}
      </span>
      <h1 className="mt-3 font-display text-[25px] font-medium leading-snug sm:text-[29px]">
        {t(warmup.prompt)}
      </h1>
      {warmup.hint ? (
        <p className="mt-2 text-sm text-muted-foreground">{t(warmup.hint)}</p>
      ) : null}

      <div className="mt-7">
        {warmup.kind === 'choice' ? (
          <div className="flex flex-col gap-2">
            {warmup.options.map((opt, i) => (
              <button
                key={opt}
                type="button"
                onClick={() => {
                  onChange(opt)
                  onPick()
                }}
                className={cn(
                  'flex w-full cursor-pointer items-center gap-3 rounded-[4px] border px-4 py-3 text-left text-[15px] transition-colors',
                  value === opt
                    ? 'border-foreground bg-foreground/[0.05]'
                    : 'border-border hover:border-foreground/30 hover:bg-foreground/[0.03]',
                )}
              >
                <span className="flex size-5 shrink-0 items-center justify-center rounded-[3px] bg-foreground/[0.07] font-mono text-[10px]">
                  {String.fromCharCode(65 + i)}
                </span>
                {t(opt)}
              </button>
            ))}
          </div>
        ) : null}

        {warmup.kind === 'scale' ? (
          <div>
            <div className="flex gap-1.5">
              {[1, 2, 3, 4, 5].map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => {
                    onChange(String(v))
                    onPick()
                  }}
                  className={cn(
                    'h-14 flex-1 cursor-pointer rounded-[4px] border font-mono text-sm transition-colors',
                    value === String(v)
                      ? 'border-foreground bg-foreground text-background'
                      : 'border-border hover:border-foreground/30 hover:bg-foreground/[0.03]',
                  )}
                >
                  {v}
                </button>
              ))}
            </div>
            <div className="mt-2 flex justify-between text-xs text-muted-foreground">
              <span>{t(warmup.low)}</span>
              <span>{t(warmup.high)}</span>
            </div>
          </div>
        ) : null}

        {warmup.kind === 'short' ? (
          <input
            autoFocus
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={t(warmup.placeholder)}
            className="w-full border-b border-border bg-transparent pb-2 text-[19px] outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-foreground"
          />
        ) : null}
      </div>
    </div>
  )
}

function MainQuestion({
  order,
  value,
  onChange,
  inputRef,
}: {
  order: { question: string; unitPrice: number; shelf: string }
  value: string
  onChange: (v: string) => void
  inputRef: React.RefObject<HTMLTextAreaElement | null>
}) {
  const t = useT()
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-[2px] bg-[#866FF2]/12 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[1px] text-[#5B44C7]">
          {t(MAIN_GUIDANCE.eyebrow)}
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">
          {t(order.shelf)} · ₩{order.unitPrice.toLocaleString()}
        </span>
      </div>

      <Identity />

      <h1 className="mt-3 font-display text-[23px] font-medium leading-snug sm:text-[27px]">
        {order.question}
      </h1>

      <textarea
        ref={inputRef}
        rows={6}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t('Write it the way it happened.')}
        className="mt-6 w-full resize-none rounded-[4px] border border-border bg-card p-4 text-[15px] leading-relaxed outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-foreground/40"
      />

      <div className="mt-4 rounded-[4px] border border-border bg-foreground/[0.03] p-4">
        <ul className="flex flex-col gap-1.5">
          {MAIN_GUIDANCE.do.map((d) => (
            <li
              key={d}
              className="flex gap-2.5 text-[13px] leading-relaxed text-foreground/85"
            >
              <Check className="mt-0.5 size-3.5 shrink-0 text-[#0F766E]" />
              {t(d)}
            </li>
          ))}
          <li className="flex gap-2.5 text-[13px] leading-relaxed text-muted-foreground">
            <X className="mt-0.5 size-3.5 shrink-0" />
            {t(MAIN_GUIDANCE.dont)}
          </li>
        </ul>
      </div>
    </div>
  )
}

/**
 * What the buyer will see attached to this passage. Shown while writing, not
 * after, so the register is obvious: a nurse answering a nurse question is
 * exactly what the buyer is paying for, and a stranger to the field can see
 * they are one before they start typing.
 */
function Identity() {
  const { profile } = useUi()
  const t = useT()
  if (!profile) {
    return (
      <p className="mt-3 flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">
        {t('Answering anonymously —')}{' '}
        <Link to="/onboarding" className="underline underline-offset-2">
          {t('set up a profile')}
        </Link>{' '}
        {t('so the asker can tell you were there')}
      </p>
    )
  }
  const label = (list: { value: string; label: string }[], v: string) =>
    list.find((o) => o.value === v)?.label ?? v
  return (
    <p className="mt-3 font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">
      {t('Answering as')}{' '}
      <span className="text-foreground">{profile.handle}</span> ·{' '}
      {t(label(AGE_BANDS, profile.ageBand))} ·{' '}
      {t(label(REGIONS, profile.region))} ·{' '}
      {t(label(HOUSEHOLDS, profile.household))} ·{' '}
      {t(CATEGORY_BY_ID[profile.field]?.label ?? '')}
    </p>
  )
}
