import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, Navigate } from 'react-router-dom'
import {
  Activity,
  ArrowRight,
  BrainCircuit,
  CheckCircle2,
  Cloud,
  CloudCog,
  Database,
  GitBranch,
  Layers3,
  Loader2,
  Network,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Waypoints,
} from 'lucide-react'
import { AuthUnavailable } from '@/components/AuthUnavailable'
import { Button } from '@/components/ui/button'
import {
  getAdminDataPipeline,
  type AdminDataPipelineSnapshot,
} from '@/lib/api'
import { cn } from '@/lib/utils'
import { useUi } from '@/state/ui'

const POLL_MS = 2_500

const stageNames: Record<string, string> = {
  api: 'API intake',
  identity: 'Identity',
  retrieval: 'Search & rank',
  generation: 'Vertex generation',
  coverage: 'Human open call',
  memory: 'Memory access',
  settlement: 'x402 settlement',
  orchestration: 'Research worker',
}

const sourceNames: Record<string, string> = {
  web: 'Web app',
  api: 'API client',
  'agent-mcp': 'Agent MCP',
  'obulus-mcp': 'Obulus MCP',
  'gemini-mcp': 'Gemini MCP',
  'claude-mcp': 'Claude MCP',
  'codex-mcp': 'Codex MCP',
  'cloud-worker': 'Cloud worker',
}

export default function AdminDataPipeline() {
  const { account, authReady, authError, retryAuth } = useUi()
  const [snapshot, setSnapshot] = useState<AdminDataPipelineSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (foreground = false) => {
    if (foreground) setLoading(true)
    try {
      setSnapshot(await getAdminDataPipeline())
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '데이터 파이프라인을 불러오지 못했습니다.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!account) return
    void load(true)
    const timer = window.setInterval(() => void load(), POLL_MS)
    return () => window.clearInterval(timer)
  }, [account, load])

  if (authReady && authError && !account) {
    return <AuthUnavailable message={authError} onRetry={retryAuth} />
  }
  if (authReady && !account) {
    return <Navigate to="/login" replace />
  }

  return (
    <div className="page-enter flex-1 overflow-y-auto bg-[#f7f7f5]">
      <div className="w-full space-y-6 p-4 sm:p-6 lg:p-8">
        <header className="flex flex-wrap items-start justify-between gap-5 border-b border-black/10 pb-6">
          <div className="max-w-3xl">
            <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[1.4px] text-muted-foreground">
              <Waypoints className="size-3.5" />
              Admin · live data plane
              <span className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-1 text-[9px] text-emerald-700">
                <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />
                {snapshot ? '2.5초 갱신' : '연결 중'}
              </span>
            </div>
            <h1 className="mt-4 text-3xl font-semibold tracking-[-0.045em] text-[#101010] sm:text-4xl">
              Human DB가 쌓이고, 추상화되고, 다시 검색되는 전 과정
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
              현재 저장·검색·PageRank 경로와 다음 적재 정책을 한 화면에서 분리해 보여줍니다.
              임베딩이 후보를 좁히고 Personalized PageRank가 질문마다 신뢰 경로를 다시 계산합니다.
              아래 이벤트에는 질문·답변·지갑·토큰이 아닌 처리 단계와 지연시간만 기록됩니다.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild variant="monoMuted" size="monoSm">
              <Link to="/admin/operations">
                <Activity className="size-3.5" /> 운영 현황
              </Link>
            </Button>
            <Button
              variant="mono"
              size="monoSm"
              disabled={loading}
              onClick={() => void load(true)}
            >
              <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} /> 새로고침
            </Button>
          </div>
        </header>

        {error ? (
          <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        ) : null}
        {loading && !snapshot ? (
          <div className="flex min-h-[420px] items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> 실시간 데이터 플레인을 연결하고 있습니다.
          </div>
        ) : snapshot ? (
          <>
            <RuntimeStrip snapshot={snapshot} />
            <RealtimePipeline snapshot={snapshot} />
            <MemoryArchitecture snapshot={snapshot} />
            <section className="grid gap-6 xl:grid-cols-[1.45fr_0.75fr]">
              <AuthorityGraph snapshot={snapshot} />
              <RealtimeFeed snapshot={snapshot} />
            </section>
            <AccumulationLayers snapshot={snapshot} />
          </>
        ) : null}
      </div>
    </div>
  )
}

function RuntimeStrip({ snapshot }: { snapshot: AdminDataPipelineSnapshot }) {
  const items = [
    {
      icon: <Cloud className="size-4" />,
      label: '실행 환경',
      value: snapshot.deployment.runtime,
      note: snapshot.deployment.service ?? snapshot.deployment.environment,
    },
    {
      icon: <Sparkles className="size-4" />,
      label: '추론 계층',
      value: snapshot.deployment.vertexModel,
      note: [snapshot.deployment.project, snapshot.deployment.location].filter(Boolean).join(' · ') || '환경 변수 미설정',
    },
    {
      icon: <Database className="size-4" />,
      label: '영속 계층',
      value: snapshot.deployment.database,
      note: `${formatCount(snapshot.memory.totalEntries)} memory rows`,
    },
    {
      icon: <Activity className="size-4" />,
      label: '최근 처리량',
      value: `${formatCount(snapshot.realtime.eventsLastFiveMinutes)} events / 5m`,
      note: `${formatCount(snapshot.realtime.eventsLastHour)} events / hour`,
    },
  ]
  return (
    <section className="grid overflow-hidden rounded-xl bg-[#111] text-white sm:grid-cols-2 xl:grid-cols-4">
      {items.map((item, index) => (
        <div
          key={item.label}
          className={cn('p-5', index > 0 && 'border-t border-white/10 sm:border-l sm:border-t-0')}
        >
          <div className="flex items-center gap-2 text-[11px] text-white/50">
            {item.icon} {item.label}
          </div>
          <p className="mt-4 truncate text-lg font-medium tracking-[-0.02em]">{item.value}</p>
          <p className="mt-1 truncate font-mono text-[10px] text-white/40">{item.note}</p>
        </div>
      ))}
    </section>
  )
}

function RealtimePipeline({ snapshot }: { snapshot: AdminDataPipelineSnapshot }) {
  const recentStages = new Set(snapshot.realtime.recentEvents.slice(0, 24).map((event) => event.stage))
  const nodes = [
    { id: 'clients', x: 24, y: 48, w: 172, title: 'Web · MCP · API', detail: '모든 기기의 익명 실행 경로', icon: '◎', active: snapshot.realtime.eventsLastFiveMinutes > 0 },
    { id: 'api', x: 246, y: 48, w: 170, title: 'Cloud Run intake', detail: '인증 · 검증 · 분류', icon: '↳', active: recentStages.has('api') || recentStages.has('identity') },
    { id: 'plan', x: 466, y: 48, w: 174, title: 'Gemini planner', detail: '질문 해석 · 도구 선택', icon: '✦', active: recentStages.has('orchestration') || recentStages.has('generation') },
    { id: 'memory', x: 690, y: 48, w: 174, title: 'Human memory', detail: `${snapshot.memory.totalEntries} rows · 원문 보존`, icon: '▤', active: recentStages.has('memory') },
    { id: 'search', x: 914, y: 48, w: 174, title: 'Hybrid retrieval', detail: `768d 후보 검색 · ${snapshot.search.queryMatches} matches`, icon: '⌕', active: recentStages.has('retrieval') },
    { id: 'rank', x: 1138, y: 48, w: 174, title: 'Personalized PageRank', detail: `d=.85 · ${snapshot.search.pageRankIterations}회 수렴`, icon: '⑂', active: recentStages.has('retrieval') },
    { id: 'raw', x: 690, y: 190, w: 174, title: '원문 + provenance', detail: `${snapshot.memory.rawObservations} L0 observations`, icon: 'L0', active: snapshot.memory.rawObservations > 0 },
    { id: 'lens', x: 914, y: 190, w: 174, title: '파생 기억 + 포인터', detail: `${snapshot.memory.derivedEntries} derived rows`, icon: 'L1', active: snapshot.memory.derivedEntries > 0 },
    { id: 'answer', x: 1138, y: 190, w: 174, title: 'Answer / Open call', detail: '근거 충분도에 따라 분기', icon: '→', active: recentStages.has('coverage') || recentStages.has('generation') },
    { id: 'settle', x: 1138, y: 314, w: 174, title: 'x402 settlement', detail: '열린 문서만 정산 · 영수증', icon: '₮', active: recentStages.has('settlement') },
  ]
  const edges = [
    ['clients', 'api'], ['api', 'plan'], ['plan', 'memory'], ['memory', 'search'], ['search', 'rank'],
    ['memory', 'raw'], ['raw', 'lens'], ['lens', 'search'], ['rank', 'answer'], ['answer', 'settle'],
  ]
  const byId = new Map(nodes.map((node) => [node.id, node]))
  return (
    <section className="overflow-hidden rounded-xl border border-black/10 bg-white">
      <SectionHeader
        icon={<Network className="size-4" />}
        eyebrow="LIVE ORCHESTRATION"
        title="n8n처럼 읽는 Obolus 실시간 처리 그래프"
        description="노드의 청록색 점은 최근 요청에서 실제로 지나간 단계입니다. 처리 내용은 저장하지 않고 경로·상태·지연시간만 집계합니다."
      />
      <div className="overflow-x-auto bg-[#0d0e10] p-4">
        <div className="relative h-[430px] min-w-[1340px] overflow-hidden rounded-lg border border-white/10 bg-[#111214]">
          <DotGrid />
          <svg className="pointer-events-none absolute inset-0 size-full" viewBox="0 0 1340 430" aria-hidden="true">
            <defs>
              <marker id="pipeline-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M 0 0 L 8 4 L 0 8 z" fill="#54585f" />
              </marker>
            </defs>
            {edges.map(([from, to]) => {
              const a = byId.get(from)!
              const b = byId.get(to)!
              const startX = a.x + a.w
              const startY = a.y + 41
              const endX = b.x
              const endY = b.y + 41
              const mid = startX + (endX - startX) / 2
              return (
                <path
                  key={`${from}-${to}`}
                  d={`M ${startX} ${startY} C ${mid} ${startY}, ${mid} ${endY}, ${endX} ${endY}`}
                  fill="none"
                  stroke={a.active && b.active ? '#35d0ba' : '#4b4f55'}
                  strokeOpacity={a.active && b.active ? 0.86 : 0.55}
                  strokeWidth={a.active && b.active ? 1.6 : 1}
                  markerEnd="url(#pipeline-arrow)"
                />
              )
            })}
          </svg>
          {nodes.map((node) => (
            <div
              key={node.id}
              className={cn(
                'absolute h-[82px] rounded-md border bg-[#17181b] p-3 text-white shadow-[0_8px_28px_rgba(0,0,0,0.28)]',
                node.active ? 'border-emerald-400/55' : 'border-white/12',
              )}
              style={{ left: node.x, top: node.y, width: node.w }}
            >
              <div className="flex items-start gap-2.5">
                <span className={cn('grid size-7 shrink-0 place-items-center rounded border font-mono text-[10px]', node.active ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300' : 'border-white/10 bg-white/5 text-white/50')}>
                  {node.icon}
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-2 text-[12px] font-medium">
                    {node.title}
                    {node.active ? <span className="size-1.5 rounded-full bg-emerald-400" /> : null}
                  </span>
                  <span className="mt-1 block truncate text-[10px] text-white/42">{node.detail}</span>
                </span>
              </div>
              <span className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
            </div>
          ))}
          <p className="absolute bottom-5 left-6 font-mono text-[10px] text-white/30">
            source event → stateless compute → durable storage → query-time authority → auditable settlement
          </p>
        </div>
      </div>
    </section>
  )
}

function MemoryArchitecture({ snapshot }: { snapshot: AdminDataPipelineSnapshot }) {
  const m = snapshot.memory
  const denseEnough = m.averageEntriesPerEntity >= 20
  return (
    <section className="space-y-6">
      <div className="overflow-hidden rounded-xl border border-black/10 bg-white">
        <SectionHeader
          icon={<Database className="size-4" />}
          eyebrow="LIVE · IMPLEMENTED NOW"
          title="현재는 원문과 근거 포인터가 달린 파생 기억을 함께 저장합니다"
          description="아래 수치는 지금 Rust 백엔드와 영속 저장소에서 실제로 읽은 값입니다. 전문가 렌즈나 150점 재귀 정책과 섞지 않습니다."
        />
        <div className="grid gap-4 px-5 pb-5 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="flex items-stretch gap-2 overflow-x-auto pb-1">
            <MemoryNode label="L0 · LIVE" title="원문 관측" value={m.rawObservations} detail="답변·전사·버전 보존" />
            <FlowArrow />
            <MemoryNode label={`EVERY ${m.activeReflectionInterval} OBSERVATIONS`} title="근거 묶음" value={m.derivedEntries} detail="최근 3개 ID와 발췌를 연결" />
            <FlowArrow />
            <MemoryNode label="QUERY TIME" title="검색·PPR" value={snapshot.search.queryMatches} detail="질문마다 다시 순위 계산" />
          </div>
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg bg-black/10 sm:grid-cols-4 lg:grid-cols-2">
            <MetricTile label="사람/엔티티" value={formatCount(m.entities)} />
            <MetricTile label="평균 관측 밀도" value={m.averageEntriesPerEntity.toFixed(1)} />
            <MetricTile label="importance 범위" value={`0–${m.activeImportanceScaleMax.toFixed(0)}`} />
            <MetricTile label="인터뷰 기반" value={formatCount(m.interviewBackedEntries)} />
          </div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
      <div className="overflow-hidden rounded-xl border border-black/10 bg-white">
        <SectionHeader
          icon={<Layers3 className="size-4" />}
          eyebrow="TARGET POLICY · LOW DENSITY"
          title="다음 적재 정책은 원문 + 네 개의 고정 전문가 렌즈입니다"
          description="엔티티당 관측이 적은 현재 단계에 적합한 목표 구조입니다. 아직 이 네 렌즈가 라이브 적재 경로에 모두 구현됐다는 뜻은 아닙니다."
        />
        <div className="space-y-4 p-5 pt-0">
          <div className="flex items-stretch gap-2 overflow-x-auto pb-1">
            <MemoryNode label="L0" title="원문" value={m.rawObservations} detail="항상 전문 병기" />
            <FlowArrow />
            <div className="grid min-w-[290px] flex-1 grid-cols-2 gap-2">
              {['심리학자', '행동경제학자', '정치학자', '인구통계학자'].map((lens) => (
                <div key={lens} className="rounded-md bg-[#f2f2ef] px-3 py-2 text-xs">
                  <span className="text-[9px] text-muted-foreground">EXPERT LENS</span>
                  <p className="mt-1 font-medium">{lens}</p>
                </div>
              ))}
            </div>
            <FlowArrow />
            <MemoryNode label="L1 · TARGET" title="전문가 통찰" value={0} detail="원문 위에 인덱스 추가" />
          </div>
          <p className="rounded-md bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
            채택 원칙: 통찰은 원문을 대체하지 않고 원문 위에 검증 가능한 인덱스로만 추가합니다. 네 축을 고정해 사람 간 비교와 벤치마크 재현성을 확보합니다.
          </p>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-black/10 bg-[#111] text-white">
        <SectionHeader
          dark
          icon={<GitBranch className="size-4" />}
          eyebrow="REFERENCE DESIGN · 2023 RECURSIVE TREE"
          title="관측이 충분히 두꺼워진 뒤 검토할 재귀 추상화 구조"
          description="설명해주신 2023 메커니즘을 목표 상태로 시각화했습니다. 현재 백엔드의 3개 단위 경량 reflection과는 별도입니다."
        />
        <div className="px-5 pb-5">
          <ol className="grid gap-2 sm:grid-cols-5">
            {[
              ['01', 'append', '관측을 자연어 스트림에 추가'],
              ['02', 'score', 'LLM 1회로 importance 1–10 (목표)'],
              ['03', `>${m.reflectionThreshold}`, '누적 임계값 검사'],
              ['04', `${m.reflectionWindow}개`, '고수준 질문 3개 생성'],
              ['05', 'pointer', '통찰을 근거와 함께 재적재'],
            ].map(([number, title, detail], index) => (
              <li key={number} className="relative rounded-md border border-white/10 bg-white/[0.035] p-3">
                <span className="font-mono text-[9px] text-white/30">{number}</span>
                <p className="mt-4 text-sm font-medium">{title}</p>
                <p className="mt-1 text-[10px] leading-4 text-white/42">{detail}</p>
                {index < 4 ? <ArrowRight className="absolute -right-3 top-1/2 z-10 size-4 -translate-y-1/2 text-white/30" /> : null}
              </li>
            ))}
          </ol>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4 text-xs">
            <span className="text-white/50">
              1–10 환산 시 기준 도달 엔티티 <strong className="ml-1 text-white">{formatCount(m.reflectionReadyEntities)}</strong>
            </span>
            <span className={cn('rounded-full px-2.5 py-1 font-mono text-[9px]', denseEnough ? 'bg-emerald-400/15 text-emerald-300' : 'bg-amber-300/10 text-amber-200')}>
              {denseEnough ? '도입 검토 가능' : '현재 밀도에서는 대기'}
            </span>
          </div>
        </div>
      </div>
      </div>
    </section>
  )
}

function AuthorityGraph({ snapshot }: { snapshot: AdminDataPipelineSnapshot }) {
  const nodes = snapshot.authorityNodes.slice(0, 18)
  const positioned = useMemo(() => {
    const maxAuthority = Math.max(...nodes.map((node) => node.authority), 0.001)
    return nodes.map((node, index) => {
      const ring = index < 5 ? 1 : index < 12 ? 2 : 3
      const within = index - (ring === 1 ? 0 : ring === 2 ? 5 : 12)
      const count = ring === 1 ? Math.min(5, nodes.length) : ring === 2 ? Math.min(7, Math.max(0, nodes.length - 5)) : Math.max(1, nodes.length - 12)
      const angle = (within / Math.max(1, count)) * Math.PI * 2 - Math.PI / 2 + ring * 0.27
      const radiusX = ring === 1 ? 130 : ring === 2 ? 265 : 390
      const radiusY = ring === 1 ? 78 : ring === 2 ? 145 : 190
      return {
        ...node,
        x: 500 + Math.cos(angle) * radiusX,
        y: 235 + Math.sin(angle) * radiusY,
        r: 8 + Math.sqrt(node.authority / maxAuthority) * 18,
      }
    })
  }, [nodes])
  const positions = new Map(positioned.map((node) => [node.id, node]))
  const edges = snapshot.authorityEdges.filter((edge) => positions.has(edge.source) && positions.has(edge.target))
  return (
    <section className="overflow-hidden rounded-xl border border-black/10 bg-white">
      <SectionHeader
        icon={<Waypoints className="size-4" />}
        eyebrow="QUERY-TIME AUTHORITY"
        title="Personalized PageRank 노드가 만드는 신뢰 경로"
        description={`임베딩이 질문과 가까운 문서를 teleport 분포로 만들고, organic·관리자 검증·실제 결과 검증 링크만 권위를 전달합니다. 유료·자기추천·동일 저자 링크는 0으로 중화됩니다.`}
      />
      <div className="overflow-x-auto px-4 pb-5">
        <svg viewBox="0 0 1000 470" className="min-w-[760px] rounded-lg bg-[#101113]" role="img" aria-label="Personalized PageRank evidence graph">
          <defs>
            <pattern id="authority-dots" width="24" height="24" patternUnits="userSpaceOnUse">
              <circle cx="1" cy="1" r="1" fill="#fff" fillOpacity="0.06" />
            </pattern>
          </defs>
          <rect width="1000" height="470" fill="url(#authority-dots)" />
          {edges.map((edge, index) => {
            const from = positions.get(edge.source)!
            const to = positions.get(edge.target)!
            return (
              <line
                key={`${edge.source}-${edge.target}-${index}`}
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                stroke={edge.propagatesAuthority ? '#55cdb9' : '#70747a'}
                strokeOpacity={edge.propagatesAuthority ? 0.42 : 0.18}
                strokeWidth={edge.propagatesAuthority ? Math.max(1, edge.weight * 2) : 1}
                strokeDasharray={edge.propagatesAuthority ? undefined : '4 5'}
              />
            )
          })}
          {positioned.map((node, index) => (
            <g key={node.id}>
              <circle cx={node.x} cy={node.y} r={node.r + 7} fill="#55cdb9" fillOpacity="0.05" />
              <circle cx={node.x} cy={node.y} r={node.r} fill={nodeColor(node.category)} stroke="#fff" strokeOpacity="0.28" />
              <text x={node.x} y={node.y + node.r + 16} textAnchor="middle" fill="#fff" fillOpacity={index < 12 ? 0.72 : 0.38} fontSize="10">
                {node.handle.length > 18 ? `${node.handle.slice(0, 17)}…` : node.handle}
              </text>
              <title>{`${node.handle}\n${node.shelf} · ${node.category}\nauthority ${(node.authority * 100).toFixed(2)}%\nquality ${(node.quality * 100).toFixed(0)} · reliability ${(node.reliability * 100).toFixed(0)}`}</title>
            </g>
          ))}
          {positioned.length === 0 ? (
            <text x="500" y="235" textAnchor="middle" fill="#fff" fillOpacity="0.45" fontSize="14">검색 가능한 문서가 쌓이면 여기에 신뢰 그래프가 형성됩니다.</text>
          ) : null}
          <g transform="translate(28 418)">
            <circle cx="6" cy="6" r="4" fill="#55cdb9" /><text x="18" y="10" fill="#fff" fillOpacity="0.55" fontSize="10">권위 전달</text>
            <line x1="105" y1="6" x2="135" y2="6" stroke="#70747a" strokeOpacity="0.5" strokeDasharray="4 5" /><text x="145" y="10" fill="#fff" fillOpacity="0.55" fontSize="10">중화된 링크</text>
            <text x="290" y="10" fill="#fff" fillOpacity="0.35" fontSize="10">노드 크기 = inspection authority · 실제 검색은 질문마다 다시 계산</text>
          </g>
        </svg>
      </div>
    </section>
  )
}

function RealtimeFeed({ snapshot }: { snapshot: AdminDataPipelineSnapshot }) {
  const events = snapshot.realtime.recentEvents.slice(0, 14)
  return (
    <section className="overflow-hidden rounded-xl border border-black/10 bg-white">
      <SectionHeader
        icon={<Activity className="size-4" />}
        eyebrow="CROSS-DEVICE EVENTS"
        title="지금 어느 클라이언트가 어떤 단계를 지나는가"
        description="Gemini·Claude·Codex MCP와 웹 앱이 같은 API를 호출하면 이 목록에 익명 처리 이벤트가 나타납니다."
      />
      <div className="px-5 pb-5">
        <div className="mb-4 flex flex-wrap gap-2">
          {snapshot.realtime.sources.length ? snapshot.realtime.sources.map((source) => (
            <span key={source.source} className="rounded-full bg-[#f0f0ed] px-2.5 py-1 font-mono text-[9px] text-foreground/70">
              {sourceNames[source.source] ?? source.source} · {source.count}
            </span>
          )) : <span className="text-xs text-muted-foreground">최근 한 시간 동안 수신한 이벤트가 없습니다.</span>}
        </div>
        <div className="divide-y divide-black/8 border-y border-black/8">
          {events.map((event) => (
            <div key={event.id} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 py-3">
              <span className={cn('size-2 rounded-full', event.status < 400 ? 'bg-emerald-500' : 'bg-red-500')} />
              <div className="min-w-0">
                <p className="truncate text-xs font-medium">
                  {sourceNames[event.source] ?? event.source}
                  {event.instance ? <span className="font-normal text-muted-foreground"> · {event.instance}</span> : null}
                </p>
                <p className="mt-1 truncate font-mono text-[9px] text-muted-foreground">
                  {stageNames[event.stage] ?? event.stage} / {event.action} / HTTP {event.status}
                </p>
              </div>
              <div className="text-right font-mono text-[9px] text-muted-foreground">
                <p>{event.latencyMs} ms</p>
                <p className="mt-1">{relativeTime(event.occurredAt)}</p>
              </div>
            </div>
          ))}
          {!events.length ? (
            <div className="py-12 text-center text-xs leading-5 text-muted-foreground">
              웹 또는 MCP에서 작업을 실행하면<br />내용 없이 처리 경로만 여기에 쌓입니다.
            </div>
          ) : null}
        </div>
      </div>
    </section>
  )
}

function AccumulationLayers({ snapshot }: { snapshot: AdminDataPipelineSnapshot }) {
  const durableSharedStore = !snapshot.deployment.database.toLowerCase().includes('sqlite')
  const layers = [
    {
      number: '01',
      icon: <Database className="size-4" />,
      title: '패널 레벨',
      value: `${formatCount(snapshot.memory.entities)} entities`,
      text: '새 패널과 새 답변이 원문 스냅샷으로 축적됩니다. 개인을 무한히 요약하기보다 모집단을 갱신해 신선도를 관리합니다.',
    },
    {
      number: '02',
      icon: <CheckCircle2 className="size-4" />,
      title: '결과·캘리브레이션 레벨',
      value: `${formatCount(snapshot.search.queryMatches)} query matches`,
      text: '예측과 실제 결과의 차이가 reliability·quality·검증 provenance로 돌아와 다음 검색의 신뢰 가중치를 바꿉니다.',
    },
    {
      number: '03',
      icon: <BrainCircuit className="size-4" />,
      title: '가중치 레벨',
      value: `${formatCount(snapshot.search.agentRuns)} agent runs`,
      text: '로드맵: 원문과 근거 그래프에서 검증된 행동 신호만 학습 후보로 승격합니다. 아직 라이브 파라미터 학습으로 연결됐다는 의미는 아닙니다.',
    },
  ]
  return (
    <section className="overflow-hidden rounded-xl border border-black/10 bg-white">
      <SectionHeader
        icon={<CloudCog className="size-4" />}
        eyebrow="SCALE MODEL"
        title="개인 DB 밖에서도 세 층으로 시스템 기억이 쌓입니다"
        description={durableSharedStore
          ? 'Cloud Run은 stateless하게 확장되고, 원문·그래프·정산 기록은 공유 영속 저장소에 남습니다. 새 인스턴스가 생겨도 같은 데이터 플레인을 읽습니다.'
          : 'Cloud Run 실행 경로는 준비되어 있지만 현재 스냅샷의 저장소는 로컬 SQLite입니다. 수평 확장 전에 Cloud SQL/PostgreSQL 같은 공유 영속 저장소로 전환해야 합니다.'}
      />
      <div className={cn(
        'mx-5 mb-5 grid gap-2 rounded-lg px-4 py-3 text-xs leading-5 sm:grid-cols-[auto_1fr_auto] sm:items-center',
        durableSharedStore ? 'bg-emerald-50 text-emerald-900' : 'bg-amber-50 text-amber-950',
      )}>
        <span className="font-mono text-[9px] uppercase tracking-[0.08em]">
          {durableSharedStore ? 'SHARED DATA PLANE · READY' : 'PRODUCTION BLOCKER'}
        </span>
        <span>
          {durableSharedStore
            ? '모든 Cloud Run 인스턴스와 원격 MCP가 동일한 영속 데이터와 운영 이벤트를 읽습니다.'
            : 'SQLite 파일은 인스턴스별·휘발성일 수 있어 다른 기기의 요청이 한 화면에 안정적으로 합쳐지지 않습니다.'}
        </span>
        <span className="font-mono text-[10px]">{snapshot.deployment.database}</span>
      </div>
      <div className="grid border-t border-black/8 md:grid-cols-3">
        {layers.map((layer, index) => (
          <div key={layer.number} className={cn('p-5', index > 0 && 'border-t border-black/8 md:border-l md:border-t-0')}>
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="font-mono text-[10px]">{layer.number}</span>
              {layer.icon}
            </div>
            <h3 className="mt-8 text-lg font-medium tracking-[-0.02em]">{layer.title}</h3>
            <p className="mt-2 font-mono text-[10px] text-emerald-700">{layer.value}</p>
            <p className="mt-4 text-xs leading-5 text-muted-foreground">{layer.text}</p>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3 border-t border-black/8 bg-[#f7f7f5] px-5 py-3 font-mono text-[9px] text-muted-foreground">
        <ShieldCheck className="size-3.5" />
        Admin read model에는 원문·전사문·사용자 ID·지갑·인증정보·결제 capability가 포함되지 않습니다.
      </div>
    </section>
  )
}

function SectionHeader({ icon, eyebrow, title, description, dark = false }: { icon: ReactNode; eyebrow: string; title: string; description: string; dark?: boolean }) {
  return (
    <header className="p-5">
      <div className={cn('flex items-center gap-2 font-mono text-[9px] uppercase tracking-[1.2px]', dark ? 'text-white/38' : 'text-muted-foreground')}>
        {icon} {eyebrow}
      </div>
      <h2 className={cn('mt-3 text-xl font-medium tracking-[-0.03em]', dark && 'text-white')}>{title}</h2>
      <p className={cn('mt-2 max-w-3xl text-xs leading-5', dark ? 'text-white/45' : 'text-muted-foreground')}>{description}</p>
    </header>
  )
}

function MemoryNode({ label, title, value, detail }: { label: string; title: string; value: number; detail: string }) {
  return (
    <div className="min-w-[142px] rounded-md border border-black/10 bg-white p-3">
      <span className="font-mono text-[9px] text-muted-foreground">{label}</span>
      <p className="mt-3 text-sm font-medium">{title}</p>
      <p className="mt-1 font-mono text-[10px] text-emerald-700">{formatCount(value)}</p>
      <p className="mt-2 text-[10px] text-muted-foreground">{detail}</p>
    </div>
  )
}

function FlowArrow() {
  return <ArrowRight className="mt-12 size-4 shrink-0 text-muted-foreground/45" />
}

function MetricTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[#f4f4f1] px-4 py-3">
      <p className="font-mono text-[9px] uppercase tracking-[0.08em] text-muted-foreground">{label}</p>
      <p className="mt-2 text-lg font-medium tabular-nums tracking-[-0.025em]">{value}</p>
    </div>
  )
}

function DotGrid() {
  return (
    <div
      className="pointer-events-none absolute inset-0 opacity-60"
      style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,.11) 1px, transparent 1px)', backgroundSize: '20px 20px' }}
    />
  )
}

function formatCount(value: number) {
  return new Intl.NumberFormat('ko-KR', { notation: value >= 10_000 ? 'compact' : 'standard' }).format(value)
}

function relativeTime(timestamp: number) {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1_000))
  if (seconds < 60) return `${seconds}초 전`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}분 전`
  return `${Math.floor(minutes / 60)}시간 전`
}

function nodeColor(category: string) {
  const palette: Record<string, string> = {
    life: '#7c6ef6', business: '#2aa98f', sales: '#ef7b56', development: '#4d8ee8', education: '#a371e8', exercise: '#24bd94', health: '#2ab8cc', family: '#e756a5', food: '#d9a61f', travel: '#ec5b68', money: '#8a68e8',
    생활: '#7c6ef6', 사업: '#2aa98f', 영업: '#ef7b56', 개발: '#4d8ee8', 교육: '#a371e8', 운동: '#24bd94', 건강: '#2ab8cc', 가족: '#e756a5', 음식: '#d9a61f', 여행: '#ec5b68', 돈: '#8a68e8',
  }
  return palette[category] ?? '#7c8792'
}
