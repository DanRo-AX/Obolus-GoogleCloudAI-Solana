import { cn } from '@/lib/utils'
import { useT } from '@/i18n'

const INK = '#111111'
const MUTED = '#667085'
const LINE = '#aeb5bc'
const PANEL = '#f7f8f8'
const AI = '#2563eb'
const BRANCH = '#7c3aed'
const SETTLEMENT = '#0f766e'
const MEMORY = '#b45309'

type NodeProps = {
  x: number
  y: number
  step: string
  title: string
  detail: [string, string]
  accent?: string
}

type EdgeProps = {
  d: string
  tone?: 'line' | 'ai' | 'branch' | 'settlement' | 'memory'
  label?: string
  labelX?: number
  labelY?: number
  dash?: boolean
}

const COLORS = {
  line: LINE,
  ai: AI,
  branch: BRANCH,
  settlement: SETTLEMENT,
  memory: MEMORY,
} as const

/**
 * Actual product architecture rather than a decorative lifecycle: Gemini
 * plans, Rust enforces, Pay.sh settles, and versioned human memory feeds the
 * next search. Every arrow terminates at a node boundary.
 */
export function FlowDiagram({ className }: { className?: string }) {
  const t = useT()

  const Node = ({ x, y, step, title, detail, accent = INK }: NodeProps) => (
    <g>
      <rect x={x} y={y} width={260} height={96} rx={7} fill="#ffffff" stroke="#cfd4d8" />
      <rect x={x} y={y} width={4} height={96} rx={2} fill={accent} />
      <text x={x + 18} y={y + 20} fill={accent} fontSize={9.5} letterSpacing={1.35} fontFamily="var(--font-geist-mono)">
        {step}
      </text>
      <text x={x + 18} y={y + 44} fill={INK} fontSize={14.5} fontWeight={600} fontFamily="var(--font-geist-sans)">
        {title}
      </text>
      <text x={x + 18} y={y + 67} fill={MUTED} fontSize={10.5} fontFamily="var(--font-geist-sans)">
        <tspan x={x + 18}>{detail[0]}</tspan>
        <tspan x={x + 18} dy={15}>{detail[1]}</tspan>
      </text>
    </g>
  )

  const Edge = ({ d, tone = 'line', label, labelX, labelY, dash = false }: EdgeProps) => {
    const color = COLORS[tone]
    return (
      <g>
        <path d={d} fill="none" stroke={color} strokeWidth={tone === 'line' ? 1.25 : 1.6} strokeDasharray={dash ? '5 5' : undefined} strokeLinejoin="round" markerEnd={`url(#arrow-${tone})`} />
        {label ? (
          <g>
            <rect x={(labelX ?? 0) - 5} y={(labelY ?? 0) - 12} width={Math.max(64, label.length * 6.2)} height={18} rx={4} fill="#ffffff" />
            <text x={labelX} y={labelY} fill={color} fontSize={9.5} letterSpacing={0.4} fontFamily="var(--font-geist-mono)">{label}</text>
          </g>
        ) : null}
      </g>
    )
  }

  const Lane = ({ y, label, meta }: { y: number; label: string; meta: string }) => (
    <g>
      <text x={30} y={y} fill={INK} fontSize={10.5} fontWeight={600} letterSpacing={1.5} fontFamily="var(--font-geist-mono)">{label}</text>
      <text x={950} y={y} textAnchor="end" fill={MUTED} fontSize={9.5} letterSpacing={0.7} fontFamily="var(--font-geist-mono)">{meta}</text>
    </g>
  )

  return (
    <figure className={cn('not-prose', className)}>
      <div className="overflow-x-auto rounded-[8px] border border-border bg-white p-3 sm:p-5">
        <svg viewBox="0 0 980 1060" className="h-auto w-full min-w-[820px]" role="img" aria-label={t('Obulus system architecture from question to evidence, payment and reusable memory')}>
          <defs>
            {(Object.entries(COLORS) as Array<[keyof typeof COLORS, string]>).map(([id, color]) => (
              <marker key={id} id={`arrow-${id}`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
                <path d="M0 0 L8 4 L0 8 z" fill={color} />
              </marker>
            ))}
            <pattern id="diagram-grid" width="24" height="24" patternUnits="userSpaceOnUse">
              <path d="M24 0H0V24" fill="none" stroke="#e9ecef" strokeWidth="0.6" />
            </pattern>
          </defs>

          <rect width={980} height={180} rx={8} fill={PANEL} />
          <rect y={195} width={980} height={540} rx={8} fill="#fbfbfb" />
          <rect y={750} width={980} height={310} rx={8} fill={PANEL} />
          <rect width={980} height={1060} rx={8} fill="url(#diagram-grid)" opacity={0.42} />

          <Lane y={30} label={t('1 · REQUEST AND AUTONOMY')} meta={t('probabilistic planning · deterministic control')} />
          <Lane y={225} label={t('2 · FREE SEARCH AND DECISION')} meta={t('metadata stays free · private passages stay closed')} />
          <Lane y={780} label={t('3 · PAYMENT, OUTPUT AND FLYWHEEL')} meta={t('exact settlement · recoverable receipts · reusable memory')} />

          <Node x={30} y={58} step={t('INPUT')} title={t('Question or agent request')} detail={[t('Web UI · external AI through MCP'), t('request, audience constraints and budget')]} />
          <Node x={360} y={58} step={t('GEMINI · VERTEX AI')} title={t('Plan and select tools')} detail={[t('break the request into evidence needs'), t('choose search, baseline or research tools')]} accent={AI} />
          <Node x={690} y={58} step={t('RUST · CLOUD RUN')} title={t('Deterministic control plane')} detail={[t('validate schema, policy, consent and budget'), t('allow only an auditable next action')]} />
          <Edge d="M290 106 H358" tone="ai" />
          <Edge d="M620 106 H688" tone="ai" />

          <Node x={30} y={252} step={t('HUMAN DB CATALOG')} title={t('Free metadata index')} detail={[t('domain, freshness, consent and price'), t('identity is visible; passages stay closed')]} />
          <Node x={360} y={252} step={t('RETRIEVAL')} title={t('Retrieve candidate DBs')} detail={[t('lexical, hash and metadata relevance'), t('no source passage is opened or paid yet')]} />
          <Node x={690} y={252} step={t('AUTHORITY')} title={t('Rank for this question')} detail={[t('Personalized PageRank, trust, freshness'), t('remove repeats; preserve independent authors')]} />
          <Edge d="M820 154 V202 H490 V250" tone="ai" label={t('tool call')} labelX={628} labelY={197} />
          <Edge d="M290 300 H358" dash />
          <Edge d="M620 300 H688" />
          <Edge d="M820 348 V382" />

          <g>
            <path d="M820 384 L890 429 L820 474 L750 429 Z" fill="#ffffff" stroke={BRANCH} strokeWidth={1.6} />
            <text x={820} y={419} textAnchor="middle" fill={BRANCH} fontSize={9.5} letterSpacing={1.1} fontFamily="var(--font-geist-mono)">{t('COVERAGE')}</text>
            <text x={820} y={441} textAnchor="middle" fill={INK} fontSize={13.5} fontWeight={600} fontFamily="var(--font-geist-sans)">{t('Enough evidence?')}</text>
          </g>

          <Node x={360} y={505} step={t('HIT · MINIMUM BUNDLE')} title={t('Lock an exact invoice')} detail={[t('selected document, hash, version and owner'), t('exact price and 90/10 split fixed before pay')]} accent={BRANCH} />
          <Node x={690} y={505} step={t('MISS · FREE BASELINE')} title={t('Explain the missing evidence')} detail={[t('Gemini receives the question, never private text'), t('the result is free and not human evidence')]} accent={BRANCH} />
          <Node x={690} y={620} step={t('ONLY IF THE USER CHOOSES')} title={t('Targeted Open Call')} detail={[t('set audience, answer count and reward'), t('accepted answers become versioned documents')]} accent={BRANCH} />
          <Edge d="M750 429 H490 V503" tone="branch" label={t('sufficient')} labelX={596} labelY={420} />
          <Edge d="M820 474 V503" tone="branch" label={t('insufficient')} labelX={831} labelY={494} />
          <Edge d="M820 601 V618" tone="branch" label={t('firsthand evidence is essential')} labelX={690} labelY={616} />

          <Node x={30} y={805} step={t('USER KEY BOUNDARY')} title={t('Bounded funding authority')} detail={[t('Phantom signs only explicit top-ups and withdrawals'), t('the server never receives the user private key')]} accent={SETTLEMENT} />
          <Node x={360} y={805} step={t('HTTP 402 · PAY.SH · CLOUD KMS')} title={t('Verify and settle each document')} detail={[t('quote-bound, idempotent and recoverable'), t('unopened documents cost nothing')]} accent={SETTLEMENT} />
          <Node x={690} y={805} step={t('SOLANA · USDC')} title={t('Onchain settlement and receipt')} detail={[t('facilitator sponsors the network fee'), t('90% to owner · 10% protocol · explorer proof')]} accent={SETTLEMENT} />
          <Edge d="M490 601 V803" tone="settlement" label={t('pay selected URLs')} labelX={502} labelY={748} />
          <Edge d="M820 716 V744 H648 V853 H622" tone="settlement" label={t('fund accepted answers')} labelX={664} labelY={738} />
          <Edge d="M290 853 H358" tone="settlement" />
          <Edge d="M620 853 H688" tone="settlement" />

          <Node x={30} y={940} step={t('PAID OUTPUT')} title={t('Passages, citations and receipt')} detail={[t('only paid passages cross the access boundary'), t('every opened document remains recoverable')]} accent={SETTLEMENT} />
          <Node x={360} y={940} step={t('GEMINI SYNTHESIS')} title={t('Answer from allowed evidence')} detail={[t('preserve agreement, disagreement and source'), t('never invent a human claim or citation')]} accent={AI} />
          <Node x={690} y={940} step={t('MEMORY + EVIDENCE GRAPH')} title={t('Version, reuse and reward')} detail={[t('hash, source, consent, correction and reuse'), t('new authority signals and owner earnings accrue')]} accent={MEMORY} />
          <Edge d="M490 901 V916 H160 V938" tone="settlement" label={t('unlock')} labelX={270} labelY={910} />
          <Edge d="M820 901 V938" tone="settlement" label={t('receipt')} labelX={830} labelY={925} />
          <Edge d="M290 988 H358" tone="ai" />
          <Edge d="M360 988 H16 V106 H28" tone="ai" label={t('cited answer returns')} labelX={28} labelY={976} />
          <Edge d="M950 668 H968 V988 H952" tone="memory" label={t('accepted answer')} labelX={850} labelY={728} />
          <Edge d="M950 972 H972 V204 H160 V250" tone="memory" dash label={t('index and authority update')} labelX={682} labelY={198} />
        </svg>
      </div>

      <figcaption className="mt-3 grid gap-2 font-mono text-[10px] uppercase tracking-[0.8px] text-muted-foreground sm:grid-cols-2 xl:grid-cols-4">
        <span className="flex items-center gap-2"><span className="h-px w-5" style={{ background: AI }} />{t('Gemini plans; Rust enforces')}</span>
        <span className="flex items-center gap-2"><span className="h-px w-5" style={{ background: BRANCH }} />{t('Open Call is optional, never automatic')}</span>
        <span className="flex items-center gap-2"><span className="h-px w-5" style={{ background: SETTLEMENT }} />{t('exact payment and onchain receipt')}</span>
        <span className="flex items-center gap-2"><span className="h-px w-5" style={{ background: MEMORY }} />{t('answers improve the next search')}</span>
      </figcaption>
    </figure>
  )
}
