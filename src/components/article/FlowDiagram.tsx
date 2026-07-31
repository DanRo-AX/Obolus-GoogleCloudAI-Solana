import { useState } from 'react'
import { cn } from '@/lib/utils'

/**
 * The whole product in one picture: three lanes (who asks, the agent, who
 * answers) and the one branch everything hangs off — step 4.
 *
 * A hit runs straight down and ends as search. A miss crosses into the
 * answerer lane, comes back with answers, and only then settles. Money always
 * flows the other way, which is the line drawn in the accent colour.
 */

const INK = '#0a0a0a'
const LINE = '#c9ced0'
const MUTED = '#6b7280'
const ACCENT = '#0F766E' // settlement
const BRANCH = '#866FF2' // the step-4 decision

type NodeId = 'ask' | 'search' | 'rank' | 'branch' | 'call' | 'settle' | 'receipt' | 'memory' | 'shelves'

/** Which nodes stay lit when one is hovered. */
const RELATED: Record<NodeId, NodeId[]> = {
  ask: ['ask', 'search'],
  search: ['ask', 'search', 'rank', 'shelves'],
  shelves: ['search', 'shelves'],
  rank: ['search', 'rank', 'branch'],
  branch: ['rank', 'branch', 'call', 'settle'],
  call: ['branch', 'call', 'settle'],
  settle: ['branch', 'call', 'settle', 'receipt', 'memory'],
  receipt: ['settle', 'receipt'],
  memory: ['settle', 'memory', 'shelves'],
}

export function FlowDiagram({ className }: { className?: string }) {
  const [hot, setHot] = useState<NodeId | null>(null)
  const lit = (id: NodeId) => !hot || RELATED[hot].includes(id)

  const Node = ({
    id,
    x,
    y,
    w = 240,
    step,
    title,
    sub,
  }: {
    id: NodeId
    x: number
    y: number
    w?: number
    step?: string
    title: string
    sub?: string
  }) => (
    <g
      onMouseEnter={() => setHot(id)}
      onMouseLeave={() => setHot(null)}
      style={{ opacity: lit(id) ? 1 : 0.22, transition: 'opacity 200ms' }}
      className="cursor-default"
    >
      <rect
        x={x}
        y={y}
        width={w}
        height={60}
        rx={4}
        fill="#ffffff"
        stroke={hot === id ? INK : LINE}
        strokeWidth={hot === id ? 1.5 : 1}
      />
      {step ? (
        <text
          x={x + 14}
          y={y + 21}
          fill={MUTED}
          fontSize={9}
          letterSpacing={1.4}
          fontFamily="var(--font-geist-mono)"
        >
          {step}
        </text>
      ) : null}
      <text
        x={x + 14}
        y={y + 43}
        fill={INK}
        fontSize={13.5}
        fontWeight={500}
        fontFamily="var(--font-geist-sans)"
      >
        {title}
      </text>
      {sub ? (
        <text
          x={x + w - 14}
          y={y + 43}
          textAnchor="end"
          fill={MUTED}
          fontSize={10.5}
          fontFamily="var(--font-geist-mono)"
        >
          {sub}
        </text>
      ) : null}
    </g>
  )

  const Lane = ({ y, label }: { y: number; label: string }) => (
    <text
      x={0}
      y={y}
      fill={MUTED}
      fontSize={9.5}
      letterSpacing={1.6}
      fontFamily="var(--font-geist-mono)"
    >
      {label}
    </text>
  )

  const Edge = ({
    d,
    on,
    color = LINE,
    label,
    lx,
    ly,
    dash,
  }: {
    d: string
    on: NodeId[]
    color?: string
    label?: string
    lx?: number
    ly?: number
    dash?: boolean
  }) => {
    const shown = !hot || on.every((n) => RELATED[hot].includes(n))
    return (
      <g style={{ opacity: shown ? 1 : 0.15, transition: 'opacity 200ms' }}>
        <path
          d={d}
          fill="none"
          stroke={color}
          strokeWidth={1.2}
          strokeDasharray={dash ? '4 4' : undefined}
          markerEnd={`url(#arrow-${color === ACCENT ? 'accent' : color === BRANCH ? 'branch' : 'line'})`}
        />
        {label ? (
          <text
            x={lx}
            y={ly}
            fill={color === LINE ? MUTED : color}
            fontSize={9.5}
            letterSpacing={1.2}
            fontFamily="var(--font-geist-mono)"
          >
            {label}
          </text>
        ) : null}
      </g>
    )
  }

  return (
    <figure className={cn('not-prose', className)}>
      <div className="overflow-x-auto rounded-[6px] border border-border bg-card p-5 sm:p-7">
        <svg
          viewBox="0 0 1000 730"
          className="h-auto w-full min-w-[720px]"
          role="img"
          aria-label="How one question moves through OPENSHELF"
        >
          <defs>
            {[
              ['line', LINE],
              ['accent', ACCENT],
              ['branch', BRANCH],
            ].map(([id, c]) => (
              <marker
                key={id}
                id={`arrow-${id}`}
                viewBox="0 0 8 8"
                refX="7"
                refY="4"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M0 0 L8 4 L0 8 z" fill={c} />
              </marker>
            ))}
          </defs>

          <Lane y={68} label="ASKER" />
          <Lane y={172} label="SHELF-1" />
          <Lane y={456} label="ANSWERER" />

          {/* main spine ------------------------------------------------ */}
          <Node id="ask" x={110} y={36} step="STEP 1" title="Ask a question" />
          <Node
            id="search"
            x={380}
            y={140}
            step="STEP 2"
            title="Search the shelves"
          />
          <Node
            id="shelves"
            x={720}
            y={140}
            w={240}
            step="THE SHELVES"
            title="24 shelves"
            sub="people's documents"
          />
          <Node
            id="rank"
            x={380}
            y={228}
            step="STEP 3"
            title="Rank by similarity"
          />

          {/* step 4 — the branch --------------------------------------- */}
          <g
            onMouseEnter={() => setHot('branch')}
            onMouseLeave={() => setHot(null)}
            style={{ opacity: lit('branch') ? 1 : 0.22, transition: 'opacity 200ms' }}
          >
            <path
              d="M500 306 L586 352 L500 398 L414 352 Z"
              fill="#ffffff"
              stroke={BRANCH}
              strokeWidth={hot === 'branch' ? 1.8 : 1.2}
            />
            <text
              x={500}
              y={347}
              textAnchor="middle"
              fill={MUTED}
              fontSize={9.5}
              letterSpacing={1.4}
              fontFamily="var(--font-geist-mono)"
            >
              STEP 4
            </text>
            <text
              x={500}
              y={364}
              textAnchor="middle"
              fill={INK}
              fontSize={13}
              fontWeight={500}
              fontFamily="var(--font-geist-sans)"
            >
              Hit or miss
            </text>
          </g>

          <Node
            id="call"
            x={720}
            y={424}
            step="STEP 5"
            title="Open call"
            sub="₩ per answer"
          />
          <Node
            id="settle"
            x={380}
            y={528}
            step="STEP 6"
            title="Settle over x402"
          />
          <Node
            id="receipt"
            x={110}
            y={632}
            step="STEP 7"
            title="Passages + receipt"
          />
          <Node
            id="memory"
            x={720}
            y={632}
            step="STEP 7"
            title="Memory accrues"
          />

          {/* edges ----------------------------------------------------- */}
          <Edge
            d="M230 96 L230 122 L500 120 L500 138"
            on={['ask', 'search']}
          />
          <Edge
            d="M620 168 L716 168"
            on={['search', 'shelves']}
            dash
          />
          <Edge d="M500 200 L500 226" on={['search', 'rank']} />
          <Edge d="M500 284 L500 304" on={['rank', 'branch']} />
          <Edge
            d="M500 398 L500 526"
            on={['branch', 'settle']}
            color={BRANCH}
            label="HIT · answer exists"
            lx={512}
            ly={468}
          />
          <Edge
            d="M586 352 L840 352 L840 422"
            on={['branch', 'call']}
            color={BRANCH}
            label="MISS · commission it"
            lx={620}
            ly={342}
          />
          <Edge
            d="M840 484 L840 556 L622 556"
            on={['call', 'settle']}
            label="answers return"
            lx={666}
            ly={546}
          />
          <Edge
            d="M440 588 L440 612 L230 612 L230 630"
            on={['settle', 'receipt']}
            label="passages"
            lx={286}
            ly={604}
          />
          <Edge
            d="M560 588 L560 612 L840 612 L840 630"
            on={['settle', 'memory']}
            color={ACCENT}
            label="₩ to each author"
            lx={620}
            ly={604}
          />
          <Edge
            d="M960 632 L980 632 L980 200 L962 200"
            on={['memory', 'shelves']}
            dash
            label="thickens the shelf"
            lx={848}
            ly={676}
          />
        </svg>
      </div>

      <figcaption className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">
        <span className="flex items-center gap-2">
          <span className="h-px w-5" style={{ background: BRANCH }} />
          the branch everything hangs off
        </span>
        <span className="flex items-center gap-2">
          <span className="h-px w-5" style={{ background: ACCENT }} />
          money, always the other way
        </span>
        <span className="ml-auto hidden sm:block">hover a box to isolate it</span>
      </figcaption>
    </figure>
  )
}
