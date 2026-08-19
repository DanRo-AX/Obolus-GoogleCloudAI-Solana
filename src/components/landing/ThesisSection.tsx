import { useT } from '@/i18n'

/**
 * The opening argument, made by showing rather than claiming.
 *
 * The thesis is stated once, centred, as the page's second big moment after the
 * hero — then the gap it describes is shown directly: what a general model says
 * on the dull, generic side, and what four people who actually live there say on
 * a vivid card whose colour does the arguing. No section eyebrow, no top stripe;
 * the colour is the only thing spent, and it is spent at full strength.
 */
export function ThesisSection() {
  const t = useT()
  return (
    <section className="border-t border-border px-4 py-20 sm:px-8 sm:py-28">
      <div className="mx-auto max-w-[92rem]">
        {/* The thesis, centred — the page's one deliberate break from the
            left-aligned column, so the eye lands here before the comparison. */}
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-balance font-display text-[30px] leading-[1.14] sm:text-[46px]">
            {t('Firsthand knowledge only sold in bulk. Here it sells one answer at a time.')}
          </h2>
          <p className="mx-auto mt-6 max-w-2xl text-pretty text-[17px] leading-8 text-foreground/80">
            {t(
              'A panel of three hundred, a year-long subscription, one thick report — that used to be the smallest thing you could buy. Here the unit is a single document, a single open, a single answer. You pay only for the evidence you need, and the person who lived it is paid for it.',
            )}
          </p>
        </div>

        {/* The gap, shown: a dull generic answer beside a vivid human one. */}
        <div className="mt-16 grid grid-cols-1 items-stretch gap-4 lg:grid-cols-2">
          {/* The general-model answer sits on a soft, atmospheric blue wash:
              visually inviting, but still deliberately less information-dense
              than the firsthand evidence beside it. */}
          <div className="relative flex min-h-[300px] flex-col overflow-hidden rounded-lg bg-[#1fcfd5] text-white ring-1 ring-inset ring-white/30">
            <AtmosphericBlueBackground />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/10 via-black/20 to-black/35" />
            <div className="relative z-10 flex items-baseline justify-between gap-3 px-6 pt-6 sm:px-8 sm:pt-8">
              <span className="font-mono text-[10px] uppercase tracking-[1.5px] text-white/80">
                {t('A general model')}
              </span>
              <span className="font-mono text-[10px] uppercase tracking-[1.5px] text-white/80">
                {t('Free')}
              </span>
            </div>
            <p className="relative z-10 px-6 pt-5 text-pretty text-[17px] leading-relaxed text-white drop-shadow-[0_1px_8px_rgba(0,34,76,0.36)] sm:px-8">
              {t(
                '“Locals tend to eat later than tourists. Neighbourhood bistros are usually a good bet, and reservations are generally recommended.”',
              )}
            </p>
            <p className="relative z-10 mt-auto px-6 pb-6 pt-6 font-mono text-[11px] uppercase tracking-[1px] text-white/75 sm:px-8 sm:pb-8">
              {t('Accurate, generic, and easy to guess')}
            </p>
          </div>

          {/* Four people who live there — the whole answer sits inside one
              continuous, vivid field rather than a decorative banner bolted
              above a white document. */}
          <div className="relative flex min-h-[300px] flex-col overflow-hidden rounded-lg bg-[#d63a65] text-white ring-1 ring-inset ring-white/30">
            <FirsthandRoseBackground />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/5 via-black/15 to-black/35" />
            <div className="relative z-10 flex flex-1 flex-col gap-4 p-6 sm:p-8">
              <span className="font-mono text-[10px] uppercase tracking-[1.5px] text-white/85">
                {t('Four people who live there')} · {t('example')}
              </span>
              <ul className="flex flex-col gap-3.5">
                {QUOTES.map((q) => (
                  <li key={q.handle} className="flex flex-col gap-1">
                    <span className="font-mono text-[10px] uppercase tracking-[1px] text-white/65">
                      {q.handle} · {t(q.tenure)}
                    </span>
                    <span className="text-[15px] leading-relaxed text-white drop-shadow-[0_1px_8px_rgba(72,0,24,0.3)]">
                      {t(q.line)}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-auto pt-2 font-mono text-[11px] uppercase tracking-[1px] text-white/80">
                {t('Four authors paid · USDC on Solana')}
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

/**
 * A contained, photo-like wash inspired by refracted light rather than a
 * conventional two-stop gradient. SVG paths let the white and cobalt ribbons
 * sweep diagonally without leaking past the card's rounded clipping edge.
 */
function AtmosphericBlueBackground() {
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 size-full"
      preserveAspectRatio="xMidYMid slice"
      viewBox="0 0 1000 700"
    >
      <defs>
        <linearGradient id="atmosphere-base" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="#32e4df" />
          <stop offset="0.48" stopColor="#199ccc" />
          <stop offset="1" stopColor="#79e4e3" />
        </linearGradient>
        <linearGradient id="atmosphere-blue" x1="0.2" x2="0.9" y1="0" y2="1">
          <stop offset="0" stopColor="#0f75c8" />
          <stop offset="0.55" stopColor="#174ca7" />
          <stop offset="1" stopColor="#2774c9" />
        </linearGradient>
        <linearGradient id="atmosphere-light" x1="0.25" x2="0.9" y1="0" y2="1">
          <stop offset="0" stopColor="#faffff" stopOpacity="0.98" />
          <stop offset="0.46" stopColor="#f6ffff" stopOpacity="0.9" />
          <stop offset="1" stopColor="#d7fbff" stopOpacity="0.2" />
        </linearGradient>
        <filter id="atmosphere-blur" x="-35%" y="-35%" width="170%" height="170%">
          <feGaussianBlur stdDeviation="46" />
        </filter>
        <filter id="atmosphere-soft-blur" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="26" />
        </filter>
      </defs>

      <rect width="1000" height="700" fill="url(#atmosphere-base)" />
      <ellipse
        cx="-40"
        cy="240"
        fill="#53f5e8"
        filter="url(#atmosphere-blur)"
        opacity="0.86"
        rx="270"
        ry="470"
      />
      <path
        d="M95 -150 C245 40 300 205 390 390 C475 565 565 735 700 860 L255 860 C220 670 155 505 58 330 C-18 194 -58 35 -82 -150 Z"
        fill="url(#atmosphere-blue)"
        filter="url(#atmosphere-blur)"
        opacity="0.95"
      />
      <path
        d="M515 -180 C480 2 540 130 665 235 C780 331 930 360 1115 465 L1115 815 C966 667 813 582 676 526 C529 466 440 367 406 235 C374 112 401 -25 426 -180 Z"
        fill="url(#atmosphere-light)"
        filter="url(#atmosphere-soft-blur)"
      />
      <path
        d="M785 -120 C730 92 794 220 931 316 C1002 366 1064 403 1130 446 L1130 -120 Z"
        fill="#34dce2"
        filter="url(#atmosphere-blur)"
        opacity="0.74"
      />
    </svg>
  )
}

/** A warmer counterpart to the blue card, with the same full-card depth. */
function FirsthandRoseBackground() {
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 size-full"
      preserveAspectRatio="xMidYMid slice"
      viewBox="0 0 1000 700"
    >
      <defs>
        <linearGradient id="firsthand-base" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="#cf334a" />
          <stop offset="0.5" stopColor="#e44682" />
          <stop offset="1" stopColor="#9e276f" />
        </linearGradient>
        <linearGradient id="firsthand-ribbon" x1="0.1" x2="0.9" y1="0" y2="1">
          <stop offset="0" stopColor="#851d58" />
          <stop offset="0.52" stopColor="#b52267" />
          <stop offset="1" stopColor="#70195c" />
        </linearGradient>
        <linearGradient id="firsthand-light" x1="0.2" x2="0.88" y1="0" y2="1">
          <stop offset="0" stopColor="#fff6f1" stopOpacity="0.94" />
          <stop offset="0.48" stopColor="#ffdbe5" stopOpacity="0.72" />
          <stop offset="1" stopColor="#ffc1db" stopOpacity="0.08" />
        </linearGradient>
        <filter id="firsthand-blur" x="-35%" y="-35%" width="170%" height="170%">
          <feGaussianBlur stdDeviation="48" />
        </filter>
        <filter id="firsthand-soft-blur" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="28" />
        </filter>
      </defs>

      <rect width="1000" height="700" fill="url(#firsthand-base)" />
      <ellipse
        cx="1020"
        cy="125"
        fill="#ff4da0"
        filter="url(#firsthand-blur)"
        opacity="0.88"
        rx="310"
        ry="430"
      />
      <path
        d="M-115 18 C80 100 205 225 335 430 C438 591 540 720 688 830 L244 830 C165 668 65 534 -58 421 C-160 327 -205 164 -210 20 Z"
        fill="url(#firsthand-ribbon)"
        filter="url(#firsthand-blur)"
        opacity="0.9"
      />
      <path
        d="M150 -145 C305 -26 425 52 580 78 C725 102 855 76 1080 2 L1080 242 C870 258 705 247 544 214 C379 181 249 141 92 67 Z"
        fill="url(#firsthand-light)"
        filter="url(#firsthand-soft-blur)"
      />
      <path
        d="M720 355 C864 278 984 302 1130 382 L1130 790 C948 695 807 623 676 575 C566 535 555 442 720 355 Z"
        fill="#6d1c71"
        filter="url(#firsthand-blur)"
        opacity="0.58"
      />
    </svg>
  )
}

const QUOTES = [
  {
    handle: 'PARIS_11',
    tenure: '6 years',
    line: '“Go at 19:30 and you walk in. 20:30 and you wait forty minutes.”',
  },
  {
    handle: 'PARIS_18',
    tenure: '3 years',
    line: '“The place on my street stopped taking walk-ins in March.”',
  },
  {
    handle: 'PARIS_05',
    tenure: '4 years',
    line: '“Marché Monge, Wednesday, before 11.”',
  },
  {
    handle: 'PARIS_20',
    tenure: '9 years',
    line: '“Anywhere with a menu in four languages, keep walking.”',
  },
]
