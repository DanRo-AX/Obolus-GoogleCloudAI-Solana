import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import {
  BrainCircuit,
  Check,
  Cloud,
  Database,
  FileInput,
  GitBranch,
  Loader2,
  Network,
  Search,
  ServerCog,
  Sparkles,
} from 'lucide-react'
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  useEdgesState,
  useNodesState,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { AuthUnavailable } from '@/components/AuthUnavailable'
import { getAdminDataPipeline, type AdminDataPipelineSnapshot } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useUi } from '@/state/ui'

const POLL_MS = 2_500
type MemoryNode = AdminDataPipelineSnapshot['memoryNodes'][number]
type SystemEvent = AdminDataPipelineSnapshot['realtime']['recentEvents'][number]
type RunState = 'idle' | 'active' | 'complete'
type PipelinePlayback = { event: SystemEvent; nodeIds: string[] }
type TerminalLine = {
  id: string
  occurredAt: number
  kind: 'event' | 'error'
  source: string
  message: string
  detail: string
}

type WorkflowNodeData = Record<string, unknown> & {
  eyebrow: string
  title: string
  description: string
  icon: ReactNode
  status: 'live' | 'ready' | 'waiting'
  metric?: string
  preview?: ReactNode
  explanation: string
  actualInput: string[]
  actualOutput: string[]
  event?: SystemEvent
  variant?: 'process' | 'tool' | 'database' | 'rank'
  formula?: string
  toolInputs?: boolean
  inputPort?: boolean
  outputPort?: boolean
  topOutput?: boolean
  runState?: RunState
}

type WorkflowNode = Node<WorkflowNodeData, 'workflow'>

export default function Admin() {
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
      setError(cause instanceof Error ? cause.message : '데이터 흐름을 불러오지 못했습니다.')
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
  if (authReady && !account) return <Navigate to="/login" replace />

  return (
    <div className="page-enter flex min-h-0 flex-1 overflow-hidden bg-[#f8fafc] text-[#20242a]">
      {loading && !snapshot ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-sm text-[#68717d]">
          <Loader2 className="size-4 animate-spin" /> 실제 기억 그래프를 읽고 있습니다.
        </div>
      ) : snapshot ? (
        <MemoryWorkflow snapshot={snapshot} />
      ) : null}
      {error ? (
        <div className="fixed bottom-5 right-5 z-50 rounded-lg border border-[#d9dee5] bg-white px-4 py-3 text-xs text-[#b42318] shadow-lg">
          {error}
        </div>
      ) : null}
    </div>
  )
}

function MemoryWorkflow({ snapshot }: { snapshot: AdminDataPipelineSnapshot }) {
  const baseGraph = useMemo(() => buildWorkflowGraph(snapshot), [snapshot])
  const [nodes, setNodes, onNodesChange] = useNodesState<WorkflowNode>(baseGraph.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(baseGraph.edges)
  const [eventQueue, setEventQueue] = useState<SystemEvent[]>([])
  const [playback, setPlayback] = useState<PipelinePlayback | null>(null)
  const [terminalLines, setTerminalLines] = useState<TerminalLine[]>([])
  const [completedNodeIds, setCompletedNodeIds] = useState<Set<string>>(new Set())
  const knownEventsRef = useRef<Set<string>>(new Set())
  const initializedRef = useRef(false)
  const activeRunRef = useRef('')

  const activeNodeIds = useMemo(() => new Set(playback?.nodeIds ?? []), [playback])

  const graph = useMemo(() => {
    const tracedNodes = baseGraph.nodes.map((node) => ({
      ...node,
      data: {
        ...node.data,
        runState: activeNodeIds.has(node.id) ? 'active' : completedNodeIds.has(node.id) ? 'complete' : 'idle',
      } as WorkflowNodeData,
    }))
    const tracedEdges = baseGraph.edges.map((edge) => {
      const sourceReached = completedNodeIds.has(edge.source) || activeNodeIds.has(edge.source)
      const targetReached = completedNodeIds.has(edge.target) || activeNodeIds.has(edge.target)
      const reached = sourceReached && targetReached
      const flowing = completedNodeIds.has(edge.source) && activeNodeIds.has(edge.target)
      if (!playback && completedNodeIds.size === 0) return edge
      return {
        ...edge,
        animated: flowing,
        markerEnd: { type: MarkerType.ArrowClosed, width: 17, height: 17, color: reached ? '#0aa67f' : '#a7b0b9' },
        style: {
          ...edge.style,
          stroke: reached ? '#0aa67f' : '#a7b0b9',
          strokeWidth: reached ? 2.8 : 1.25,
          opacity: reached ? 1 : 0.34,
          filter: reached ? 'drop-shadow(0 0 4px rgba(10,166,127,.48))' : undefined,
        },
      }
    })
    return { nodes: tracedNodes, edges: tracedEdges }
  }, [activeNodeIds, baseGraph, completedNodeIds, playback])

  useEffect(() => {
    const events = snapshot.realtime.recentEvents
    if (!initializedRef.current) {
      initializedRef.current = true
      knownEventsRef.current = new Set(events.map((event) => event.id))
      setTerminalLines(sortEventsForPlayback(events.slice(0, 18)).map(eventTerminalLine))
      return
    }
    const unseen = sortEventsForPlayback(events.filter((event) => !knownEventsRef.current.has(event.id)))
    if (!unseen.length) return
    for (const event of unseen) knownEventsRef.current.add(event.id)
    setEventQueue((current) => [...current, ...unseen])
    setTerminalLines((current) => trimTerminal([...current, ...unseen.map(eventTerminalLine)]))
  }, [snapshot.realtime.recentEvents])

  useEffect(() => {
    if (playback || !eventQueue.length) return
    const [event, ...remaining] = eventQueue
    setEventQueue(remaining)
    if (activeRunRef.current !== event.instance) {
      activeRunRef.current = event.instance
      setCompletedNodeIds(new Set())
    }
    setPlayback({ event, nodeIds: nodeIdsForEvent(event) })
  }, [eventQueue, playback])

  useEffect(() => {
    if (!playback) return
    const timer = window.setTimeout(() => {
      setCompletedNodeIds((current) => new Set([...current, ...playback.nodeIds]))
      setPlayback(null)
    }, 760)
    return () => window.clearTimeout(timer)
  }, [playback])

  useEffect(() => {
    if (playback || eventQueue.length || completedNodeIds.size === 0) return
    const timer = window.setTimeout(() => {
      activeRunRef.current = ''
      setCompletedNodeIds(new Set())
    }, 1_400)
    return () => window.clearTimeout(timer)
  }, [completedNodeIds, eventQueue.length, playback])

  useEffect(() => {
    setNodes((current) => {
      const currentPositions = new Map(current.map((node) => [node.id, node.position]))
      return graph.nodes.map((node) => ({
        ...node,
        position: currentPositions.get(node.id) ?? node.position,
        selected: false,
      }))
    })
    setEdges(graph.edges)
  }, [graph, setEdges, setNodes])

  return (
    <section
      className="relative grid min-h-0 flex-1 overflow-hidden bg-[#fbfcfd]"
      style={{ gridTemplateRows: 'minmax(0, 62fr) minmax(240px, 38fr)' }}
    >
      <div className="relative min-h-0 overflow-hidden">
      <ReactFlow<WorkflowNode, Edge>
        key="obolus-memory-workflow-v4"
        nodes={nodes}
        edges={edges}
        nodeTypes={{ workflow: WorkflowCard }}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        fitView
        fitViewOptions={{ padding: 0.08, minZoom: 0.55, maxZoom: 0.94 }}
        minZoom={0.35}
        maxZoom={1.35}
        nodesDraggable
        nodesConnectable={false}
        panOnDrag
        zoomOnScroll
        zoomOnPinch
        selectionOnDrag={false}
        proOptions={{ hideAttribution: true }}
        className="bg-[#fbfcfd]"
        aria-label="Obolus 실시간 데이터 적재와 검색 아키텍처"
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1.2} color="#ccd6df" />
        <MiniMap
          pannable
          zoomable
          position="bottom-right"
          nodeColor={(node) => node.data.status === 'live' ? '#49b894' : '#d6dde4'}
          maskColor="rgba(247,249,251,.72)"
          className="!h-[92px] !w-[150px] !overflow-hidden !rounded-lg !border !border-[#d9e0e6] !bg-white !shadow-sm"
          style={{ overflow: 'hidden', clipPath: 'inset(0 round 8px)' }}
        />
        <Controls
          position="bottom-left"
          showInteractive={false}
          className="!overflow-hidden !rounded-lg !border !border-[#d9e0e6] !bg-white !shadow-sm [&_button]:!border-[#e5e9ed] [&_button]:!bg-white [&_button]:!text-[#56616c]"
        />
      </ReactFlow>
      </div>
      <PipelineTerminal lines={terminalLines} playback={playback} snapshot={snapshot} />
    </section>
  )
}

function WorkflowCard({ data }: NodeProps<WorkflowNode>) {
  const isRunning = data.runState === 'active'
  const isComplete = data.runState === 'complete'
  if (data.variant === 'database' || data.variant === 'rank') {
    return (
      <article
        className={cn(
          'group relative w-full overflow-hidden rounded-xl border bg-white shadow-[0_4px_14px_rgba(15,23,42,.08)] transition-[border-color,box-shadow,transform] duration-200',
          isRunning
            ? 'scale-[1.035] border-[#0aa67f] shadow-[0_0_0_6px_rgba(10,166,127,.15),0_0_34px_rgba(10,166,127,.38)]'
            : isComplete
              ? 'border-[#63cbb0] shadow-[0_0_0_2px_rgba(10,166,127,.1),0_5px_18px_rgba(15,23,42,.09)]'
              : data.status === 'live' ? 'border-[#9bd4c5]' : 'border-[#d3dae1]',
        )}
      >
        {data.inputPort !== false ? <Handle id="l" type="target" position={Position.Left} className="!size-2.5 !border-2 !border-white !bg-[#8a96a2] !shadow-[0_0_0_1px_#8a96a2]" /> : null}
        {data.topOutput ? <Handle id="t" type="source" position={Position.Top} className="!size-2.5 !border-2 !border-white !bg-[#8a96a2] !shadow-[0_0_0_1px_#8a96a2]" /> : null}
        {data.outputPort !== false ? <Handle id="r" type="source" position={Position.Right} className={cn('!size-2.5 !border-2 !border-white !shadow-[0_0_0_1px_#8a96a2]', data.status === 'live' ? '!bg-[#28a982]' : '!bg-[#8a96a2]')} /> : null}
        <div className="flex items-center gap-2.5 border-b border-[#e7ebef] px-3 py-2.5">
          <span className={cn('grid size-7 shrink-0 place-items-center rounded-md [&_svg]:size-4', data.variant === 'rank' ? 'bg-[#f1eef9] text-[#7e69b8]' : 'bg-[#edf8f4] text-[#16836b]')}>{data.icon}</span>
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[7px] uppercase tracking-[.11em] text-[#98a1aa]">{data.eyebrow}</p>
            <h2 className="mt-0.5 truncate text-[11px] font-semibold text-[#30373f]">{data.title}</h2>
          </div>
          {data.metric ? <span className="rounded-full bg-[#f1f4f6] px-2 py-1 font-mono text-[7px] text-[#69747f]">{data.metric}</span> : null}
        </div>
        {data.preview ? <div className="px-3 py-2.5">{data.preview}</div> : null}
        <div className="flex items-center justify-between border-t border-[#edf0f3] px-3 py-2">
          <span className="flex items-center gap-1.5 text-[7px] text-[#8c959f]"><i className={cn('size-1.5 rounded-full not-italic', data.status === 'live' ? 'bg-[#27aa82]' : 'bg-[#9ba5af]')} />{data.status === 'live' ? '실시간 갱신' : '데이터 준비됨'}</span>
          <span className={cn('text-[7px] font-medium', isRunning ? 'text-[#078364]' : 'text-[#8c959f]')}>{isRunning ? '실행 중' : isComplete ? '통과' : ''}</span>
        </div>
      </article>
    )
  }

  return (
      <article className="group relative flex w-full flex-col items-center text-center">
        <div className="relative size-[68px]">
          {data.inputPort !== false ? <Handle id="l" type="target" position={Position.Left} className="!size-2 !border-2 !border-white !bg-[#8a96a2] !shadow-[0_0_0_1px_#8a96a2]" /> : null}
          {data.topOutput ? <Handle id="t" type="source" position={Position.Top} className="!size-2 !border-2 !border-white !bg-[#8a96a2] !shadow-[0_0_0_1px_#8a96a2]" /> : null}
          {data.outputPort !== false ? <Handle id="r" type="source" position={Position.Right} className={cn('!size-2 !border-2 !border-white !shadow-[0_0_0_1px_#8a96a2]', data.status === 'live' ? '!bg-[#28a982]' : '!bg-[#8a96a2]')} /> : null}
          {data.toolInputs ? <Handle id="b1" type="target" position={Position.Bottom} style={{ left: '34%' }} className="!size-2 !border-2 !border-white !bg-[#8a96a2] !shadow-[0_0_0_1px_#8a96a2]" /> : null}
          {data.toolInputs ? <Handle id="b2" type="target" position={Position.Bottom} style={{ left: '66%' }} className="!size-2 !border-2 !border-white !bg-[#8a96a2] !shadow-[0_0_0_1px_#8a96a2]" /> : null}
          <button
            type="button"
            className={cn(
              'grid size-[68px] place-items-center rounded-full border bg-[#f7f8fa] text-[#69747f] shadow-[0_4px_12px_rgba(15,23,42,.08)] transition-[border-color,box-shadow,transform] duration-200 [&_svg]:size-7',
              isRunning
                ? 'scale-[1.12] border-[#08a37c] bg-[#effcf8] text-[#087b61] shadow-[0_0_0_8px_rgba(10,166,127,.16),0_0_36px_rgba(10,166,127,.46)]'
                : isComplete
                  ? 'border-[#62c8ad] bg-[#f3fbf8] text-[#168269] shadow-[0_0_0_3px_rgba(10,166,127,.1),0_6px_18px_rgba(15,23,42,.1)]'
                  : data.status === 'live'
                  ? 'border-[#9bd4c5] text-[#178269] hover:-translate-y-0.5 hover:shadow-[0_7px_18px_rgba(15,23,42,.12)]'
                  : 'border-[#cfd6dd] hover:-translate-y-0.5 hover:border-[#aeb8c1] hover:shadow-[0_7px_18px_rgba(15,23,42,.12)]',
            )}
            tabIndex={-1}
          >
            {data.icon}
          </button>
        </div>
        <h2 className="mt-2 max-w-[112px] text-[12px] font-semibold leading-[1.25] tracking-[-0.01em] text-[#30373f]">{data.title}</h2>
        <p className="mt-1 max-w-[116px] line-clamp-2 text-[9px] leading-[1.35] text-[#7b858f]">{data.description}</p>
        {data.metric ? <span className="mt-1.5 rounded-full bg-[#edf1f3] px-2 py-1 font-mono text-[8px] text-[#69747f]">{data.metric}</span> : null}
        <span className={cn('mt-1 text-[8px] font-medium', isRunning ? 'text-[#078364]' : isComplete ? 'text-[#42a98e]' : 'text-transparent')}>{isRunning ? '실행 중' : isComplete ? '통과' : '대기'}</span>
      </article>
  )
}

function nodeIdsForEvent(event: SystemEvent) {
  switch (event.stage) {
    case 'orchestration': return ['intake']
    case 'gateway': return ['gateway']
    case 'policy': return ['policy']
    case 'index': return ['index']
    case 'authority': return ['pagerank']
    case 'retrieval': return ['retrieval']
    case 'result':
    case 'coverage': return ['result']
    case 'settlement': return ['result']
    case 'memory': return ['memory']
    case 'generation': return event.action.includes('reflection') ? ['reflection'] : ['gemini']
    default: return []
  }
}

const EVENT_STAGE_ORDER: Record<string, number> = {
  orchestration: 0,
  gateway: 1,
  policy: 2,
  memory: 3,
  generation: 4,
  index: 5,
  authority: 6,
  retrieval: 7,
  coverage: 8,
  settlement: 8,
  result: 9,
}

function sortEventsForPlayback(events: SystemEvent[]) {
  return [...events].sort((left, right) =>
    left.occurredAt - right.occurredAt
    || (EVENT_STAGE_ORDER[left.stage] ?? 50) - (EVENT_STAGE_ORDER[right.stage] ?? 50)
    || left.id.localeCompare(right.id),
  )
}

function eventTerminalLine(event: SystemEvent): TerminalLine {
  return {
    id: `event:${event.id}`,
    occurredAt: event.occurredAt,
    kind: event.status >= 400 ? 'error' : 'event',
    source: event.source,
    message: `${event.stage}/${event.action}`,
    detail: `HTTP ${event.status} · ${event.latencyMs} ms${event.instance ? ` · ${event.instance}` : ''}`,
  }
}

function trimTerminal(lines: TerminalLine[]) {
  return lines.slice(-120)
}

function PipelineTerminal({
  lines,
  playback,
  snapshot,
}: {
  lines: TerminalLine[]
  playback: PipelinePlayback | null
  snapshot: AdminDataPipelineSnapshot
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const target = scrollRef.current
    if (target) target.scrollTop = target.scrollHeight
  }, [lines])

  return (
    <aside className="flex min-h-0 flex-col overflow-hidden border-t border-white/10 bg-[#090b0d] text-[#d8dde2] shadow-[0_-10px_30px_rgba(15,23,42,.14)]">
      <header className="flex h-11 shrink-0 items-center justify-between border-b border-white/[.08] bg-[#0d0f12] px-4 font-mono">
        <div className="flex min-w-0 items-center gap-3">
          <span className="truncate text-[11px] tracking-[.03em] text-[#aab3bc]">obulus / live execution</span>
          {playback ? <span className="rounded bg-[#0d6e57]/25 px-2 py-0.5 text-[9px] font-semibold text-[#5de0bb]">RUNNING</span> : null}
        </div>
        <div className="flex items-center gap-3 text-[9px] text-[#6f7882]">
          <span>{snapshot.realtime.eventsLastFiveMinutes} events / 5m</span>
          <span>{snapshot.deployment.runtime}</span>
          <span className="hidden sm:inline">{snapshot.deployment.service || 'local'}</span>
        </div>
      </header>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-3 font-mono text-[10px] leading-[1.7] [scrollbar-color:#30363d_transparent]">
        {!lines.length ? (
          <div className="flex h-full items-center text-[#5d6670]">
            <span className="mr-2 text-[#35c69e]">$</span>Gemini MCP의 실제 도구 호출을 기다리는 중…
          </div>
        ) : lines.map((line) => (
          <div key={line.id} className="grid grid-cols-[64px_90px_minmax(0,1fr)_auto] items-baseline gap-3 border-b border-white/[.035] py-1 last:border-0">
            <time className="text-[#58616b]">{formatClock(line.occurredAt)}</time>
            <span className={cn(
              'truncate font-semibold',
              line.kind === 'error' ? 'text-[#ff7b72]' : 'text-[#c3cad1]',
            )}>[{line.kind}]</span>
            <span className="truncate text-[#c1c8cf]">
              <b className="mr-2 font-medium text-[#7f8a95]">{line.source}</b>{line.message}
            </span>
            <span className="max-w-[280px] truncate text-right text-[#66717b]">{line.detail}</span>
          </div>
        ))}
      </div>
    </aside>
  )
}

function buildWorkflowGraph(snapshot: AdminDataPipelineSnapshot): { nodes: WorkflowNode[]; edges: Edge[] } {
  const eventsByStage = new Map<string, SystemEvent>()
  for (const event of snapshot.realtime.recentEvents) {
    if (!eventsByStage.has(event.stage)) eventsByStage.set(event.stage, event)
  }
  const recent = snapshot.memoryNodes.slice(0, 4)
  const trace = buildAbstractionTrace(snapshot)
  const active = (stage: string) => (eventsByStage.get(stage)?.occurredAt ?? 0) >= snapshot.generatedAt - POLL_MS * 2
  const liveOrReady = (stage: string, ready: boolean): WorkflowNodeData['status'] => active(stage) ? 'live' : ready ? 'ready' : 'waiting'
  const latestEvent = snapshot.realtime.recentEvents[0]
  const ranks = snapshot.authorityNodes.slice(0, 3)
  const latestQuery = snapshot.authorityContext.queryRef ? shortId(snapshot.authorityContext.queryRef) : '검색 대기'

  const nodes: WorkflowNode[] = [
    workflowNode('intake', { x: 0, y: 160 }, 170, {
      eyebrow: 'request trigger', title: 'Gemini MCP 요청', icon: <FileInput />,
      description: latestEvent ? `${latestEvent.instance}에서 ${latestEvent.action} 요청이 들어왔습니다.` : 'Gemini CLI의 Obolus 도구 호출을 기다립니다.',
      status: liveOrReady('orchestration', snapshot.realtime.recentEvents.length > 0), metric: `${snapshot.realtime.eventsLastFiveMinutes}/5m`,
      explanation: 'Gemini CLI에 연결된 Obolus MCP의 실제 tools/call만 표시합니다. 브라우저 요청과 백그라운드 워커 이벤트는 이 화면에서 제외됩니다.',
      actualInput: snapshot.realtime.sources.length ? snapshot.realtime.sources.slice(0, 4).map((source) => `${source.source}: 최근 1시간 ${source.count}건`) : ['현재 기록된 외부 요청 없음'],
      actualOutput: [latestEvent ? `${latestEvent.stage}/${latestEvent.action} 실행` : '새 실행 대기', `5분간 의미 있는 이벤트 ${snapshot.realtime.eventsLastFiveMinutes}건`], event: latestEvent,
      inputPort: false,
    }),
    workflowNode('gateway', { x: 210, y: 160 }, 170, {
      eyebrow: 'gcp ingress', title: 'Cloud Run gateway', icon: <Cloud />,
      description: `${snapshot.deployment.project || 'local'} · ${snapshot.deployment.location || 'local'}에서 인증과 라우팅을 처리합니다.`,
      status: liveOrReady('gateway', Boolean(snapshot.deployment.service)), metric: snapshot.deployment.revision ? shortId(snapshot.deployment.revision) : snapshot.deployment.environment,
      explanation: 'Cloud Run 진입점이 세션 인증, 요청 스키마, 내부 서비스 라우팅을 처리합니다. 화면의 서비스·리전·리비전 값은 현재 백엔드 배포 정보에서 직접 읽습니다.',
      actualInput: ['인증된 Web/MCP 요청', `현재 환경: ${snapshot.deployment.environment}`],
      actualOutput: [`서비스: ${snapshot.deployment.service || 'local backend'}`, `리전: ${snapshot.deployment.location || 'local'}`], event: eventsByStage.get('orchestration'),
    }),
    workflowNode('policy', { x: 420, y: 160 }, 170, {
      eyebrow: 'deterministic core', title: 'Rust policy core', icon: <ServerCog />,
      description: '권한·동의·가격·중복·상태 전이를 결정론적으로 검증합니다.',
      status: liveOrReady('policy', true), metric: 'policy',
      explanation: 'Gemini가 계획을 세워도 데이터 공개, 결제, 상태 전이의 최종 허용 여부는 Rust 코어가 결정합니다. 생성 모델이 정책을 우회할 수 없도록 결정론 경계를 둡니다.',
      actualInput: [`문서 ${snapshot.search.documents}개`, `근거 관계 ${snapshot.search.evidenceEdges}개`],
      actualOutput: [`검색 실행 ${snapshot.search.queries}회`, `Agent step ${snapshot.search.agentSteps}회`], event: eventsByStage.get('policy'),
    }),
    workflowNode('memory', { x: 620, y: 450 }, 132, {
      eyebrow: 'append-only memory', title: 'L0 Memory Stream', icon: <Database />,
      description: '원문·시점·동의·출처와 근거 포인터를 버전형 기록으로 쌓습니다.',
      status: liveOrReady('memory', snapshot.memory.totalEntries > 0), metric: `${snapshot.memory.totalEntries} entries`,
      preview: <MemoryPreview nodes={recent} />,
      explanation: '답변과 행동 관측을 요약으로 덮어쓰지 않고 L0 원문으로 append합니다. 각 reflection은 source_ids로 근거를 가리키므로 상위 개념에서 원문까지 역추적할 수 있습니다.',
      actualInput: recent.length ? recent.map((node) => `L${node.level} · ${node.displayText || structuralText(node)}`) : ['첫 관측 대기'],
      actualOutput: [`원문 ${snapshot.memory.rawObservations}개`, `엔티티 ${snapshot.memory.entities}명`, `인터뷰 기반 ${snapshot.memory.interviewBackedEntries}개`], event: eventsByStage.get('memory'),
      variant: 'tool',
      topOutput: true,
    }),
    workflowNode('reflection', { x: 630, y: 85 }, 260, {
      eyebrow: 'importance · density · reflection', title: 'L0 → L3 추상화 스택', icon: <BrainCircuit />,
      description: '중요도와 기억 밀도를 확인하고 원문 포인터를 보존한 채 상위 개념을 만듭니다.',
      status: liveOrReady('generation', snapshot.memory.totalEntries > 0), metric: `${snapshot.memory.derivedEntries} derived`,
      preview: <ReflectionPreview trace={trace} snapshot={snapshot} />,
      explanation: '새 L0 관측을 중요도 채점한 뒤 엔티티 밀도를 확인합니다. 관측이 적으면 원본과 expert lens를 병기하고, 충분해지면 L0→L1→L2→L3 재귀 reflection을 수행합니다. 각 단계는 source_ids로 바로 아래 근거를 유지합니다.',
      actualInput: [`L0 원문 ${snapshot.memory.rawObservations}개`, `엔티티당 평균 ${snapshot.memory.averageEntriesPerEntity.toFixed(2)}개`, `누적 importance ${snapshot.memory.importanceTotal.toFixed(2)}/${snapshot.memory.reflectionThreshold}`],
      actualOutput: [0, 1, 2, 3].map((level) => {
        const memory = trace.levels.get(level)?.[0]
        return memory ? `L${level}: ${memory.displayText || structuralText(memory)}` : `L${level}: 생성 대기`
      }), event: eventsByStage.get('generation'),
      toolInputs: true,
    }),
    workflowNode('index', { x: 930, y: 160 }, 112, {
      eyebrow: 'source-linked index', title: 'Evidence index', icon: <GitBranch />,
      description: '원문·추상화 포인터를 같은 문서 ID로 색인합니다.',
      status: liveOrReady('index', snapshot.search.documents > 0), metric: `${snapshot.search.documents} docs`,
      explanation: '텍스트 후보 검색과 신뢰 그래프 계산이 같은 문서 ID를 공유합니다. 추상화 문서가 검색돼도 memory_edges를 따라 L0 원문까지 내려갈 수 있습니다.',
      actualInput: [`memory edge ${snapshot.memoryEdges.length}개`, `추상화 ${snapshot.memory.derivedEntries}개`],
      actualOutput: [`문서 ${snapshot.search.documents}개`, `evidence edge ${snapshot.search.evidenceEdges}개`], event: eventsByStage.get('index'),
      variant: 'tool',
    }),
    workflowNode('retrieval', { x: 1288, y: 160 }, 180, {
      eyebrow: 'rust retrieval', title: 'Hybrid candidate search', icon: <Search />,
      description: '어휘·해시·벡터 후보를 좁히고 중복 저자와 반복 구절을 제거합니다.',
      status: liveOrReady('retrieval', snapshot.search.queries > 0), metric: latestQuery,
      explanation: 'PageRank가 전체 DB를 직접 검색하는 것이 아닙니다. 먼저 Rust 검색기가 질문과 가까운 후보를 만들고, 그 후보와 검증된 근거 관계 위에서 질문별 권위를 다시 계산합니다.',
      actualInput: [`누적 질문 ${snapshot.search.queries}개`, `query ref ${latestQuery}`],
      actualOutput: [`최근 후보 ${snapshot.authorityContext.matchedDocuments}개`, `누적 match ${snapshot.search.queryMatches}개`], event: eventsByStage.get('retrieval'),
    }),
    workflowNode('pagerank', { x: 1080, y: 160 }, 150, {
      eyebrow: 'query authority', title: 'Personalized PageRank', icon: <Network />,
      description: '질문별 teleport seed에서 신뢰 경로를 전파해 권위를 재계산합니다.',
      status: liveOrReady('authority', snapshot.authorityNodes.length > 0), metric: `${snapshot.search.pageRankIterations} iter`,
      preview: <RankPreview snapshot={snapshot} />,
      explanation: `후보 관련도를 teleport seed로 두고 damping ${Math.round(snapshot.search.pageRankDampingBps / 100)}%로 검증된 evidence edge에 권위를 전파합니다. 광고·자기추천·복제 관계는 전파에서 제외됩니다.`,
      actualInput: [`teleport seed ${snapshot.authorityNodes.filter((node) => node.teleportWeight > 0).length}개`, `권위 전파 edge ${snapshot.authorityEdges.filter((edge) => edge.propagatesAuthority).length}개`],
      actualOutput: ranks.length ? ranks.map((node, index) => `${index + 1}. ${node.handle} · ${(node.authority * 100).toFixed(2)}%`) : ['순위 계산 대기'], event: eventsByStage.get('authority'),
      variant: 'tool',
      formula: `PPR_q(d) = (1 − ${(snapshot.search.pageRankDampingBps / 10_000).toFixed(2)}) × seed_q(d) + ${(snapshot.search.pageRankDampingBps / 10_000).toFixed(2)} × Σ[PPR_q(u) × trust(u→d) / out(u)]`,
    }),
    workflowNode('result', { x: 1490, y: 160 }, 150, {
      eyebrow: 'ranked evidence', title: '조회 · 추천 결과', icon: <Check />,
      description: '질문에 필요한 최소 독립 근거만 순서대로 반환합니다.',
      status: ranks.length > 0 ? 'ready' : 'waiting', metric: `${ranks.length} results`,
      preview: <RankedPreview nodes={ranks} />,
      explanation: '상위 권위 문서에서도 같은 저자와 중복 passage를 제거하고 예산 안의 최소 독립 근거만 엽니다. 이 순위는 전역 인기 순위가 아니라 현재 질문에 대해서만 유효합니다.',
      actualInput: [`PageRank 상위 ${snapshot.authorityNodes.length}개`, `matched candidate ${snapshot.authorityContext.matchedDocuments}개`],
      actualOutput: ranks.length ? ranks.map((node) => `${node.category} · ${node.handle}`) : ['검색 결과 대기'],
      event: eventsByStage.get('result') ?? eventsByStage.get('coverage'), outputPort: false,
    }),
    workflowNode('gemini', { x: 875, y: 480 }, 120, {
      eyebrow: 'vertex ai tool', title: 'Gemini reflection', icon: <Sparkles />,
      description: `${snapshot.deployment.vertexModel}이 질문 해석과 통찰 문장을 생성합니다.`,
      status: liveOrReady('generation', snapshot.memory.derivedEntries > 0), metric: snapshot.deployment.vertexModel.replace('gemini-', ''),
      explanation: 'Gemini/Vertex AI는 중요도 채점, 고수준 질문 생성, reflection 문장 생성을 담당합니다. 근거 포인터와 공개·결제 정책은 Rust가 검증합니다.',
      actualInput: [`reflection window ${snapshot.memory.reflectionWindow}`, `최근 기억과 근거 포인터`],
      actualOutput: [`추상화 ${snapshot.memory.derivedEntries}개`, `L1→L3 통찰 문장`], event: eventsByStage.get('generation'),
      variant: 'tool',
      topOutput: true,
    }),
  ]

  const edge = (id: string, source: string, target: string, options: Partial<Edge> = {}): Edge => ({
    id, source, target, sourceHandle: 'r', targetHandle: 'l', type: 'smoothstep',
    markerEnd: { type: MarkerType.ArrowClosed, width: 15, height: 15, color: options.animated ? '#289d7c' : '#8d98a3' },
    style: { stroke: options.animated ? '#289d7c' : '#8d98a3', strokeWidth: options.animated ? 1.8 : 1.35 },
    ...options,
  })

  const flowActive = active('orchestration')
  const edges: Edge[] = [
    edge('intake-gateway', 'intake', 'gateway', { animated: flowActive }),
    edge('gateway-policy', 'gateway', 'policy', { animated: active('policy') }),
    edge('policy-index', 'policy', 'index', { animated: active('index') }),
    edge('policy-reflection', 'policy', 'reflection', { animated: active('memory') || active('generation') }),
    edge('policy-memory', 'policy', 'memory', { animated: active('memory') }),
    edge('policy-gemini', 'policy', 'gemini', { animated: active('generation') }),
    edge('reflection-index', 'reflection', 'index', { animated: snapshot.memory.totalEntries > 0 }),
    edge('index-pagerank', 'index', 'pagerank', { animated: active('authority') }),
    edge('pagerank-retrieval', 'pagerank', 'retrieval', { animated: active('retrieval') }),
    edge('retrieval-result', 'retrieval', 'result', { animated: active('result') || active('coverage') }),
    edge('memory-reflection', 'memory', 'reflection', { sourceHandle: 't', targetHandle: 'b1', type: 'smoothstep', animated: active('memory'), style: { stroke: '#8d7ac2', strokeWidth: 1.2, strokeDasharray: '5 5' }, markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: '#8d7ac2' } }),
    edge('gemini-reflection', 'gemini', 'reflection', { sourceHandle: 't', targetHandle: 'b2', type: 'smoothstep', style: { stroke: '#8d7ac2', strokeWidth: 1.2, strokeDasharray: '5 5' }, markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: '#8d7ac2' } }),
  ]
  return { nodes, edges }
}

function workflowNode(id: string, position: { x: number; y: number }, width: number, data: WorkflowNodeData): WorkflowNode {
  return { id, type: 'workflow', position, data, style: { width }, dragHandle: undefined }
}

function ReflectionPreview({
  trace,
  snapshot,
}: {
  trace: ReturnType<typeof buildAbstractionTrace>
  snapshot: AdminDataPipelineSnapshot
}) {
  const levelNames = ['원문 관측', '구체적 패턴', '반복 선택 규칙', '안정 성향']
  const levels = [0, 1, 2, 3]

  return (
    <div>
      <div className="grid grid-cols-3 gap-1.5">
        <PreviewMetric label="importance" value={`${snapshot.memory.importanceTotal.toFixed(1)}/${snapshot.memory.reflectionThreshold}`} />
        <PreviewMetric label="density" value={`${snapshot.memory.averageEntriesPerEntity.toFixed(1)}/entity`} />
        <PreviewMetric label="reflections" value={`${snapshot.memory.derivedEntries}`} />
      </div>
      <div className="mt-2 space-y-1">
        {levels.map((level) => {
          const memory = trace.levels.get(level)?.[0]
          return (
            <div key={level} className={cn('grid grid-cols-[24px_62px_1fr] items-center gap-1.5 rounded-md px-2 py-1.5', memory ? 'bg-[#f4f8f7]' : 'bg-[#f7f8fa]')}>
              <span className={cn('font-mono text-[8px] font-semibold', memory ? 'text-[#17866d]' : 'text-[#adb5bd]')}>L{level}</span>
              <span className="text-[7px] font-medium text-[#596570]">{levelNames[level]}</span>
              <span className="truncate text-[7px] text-[#7c8791]">{memory ? memory.displayText || structuralText(memory) : '아직 충분한 근거 없음'}</span>
            </div>
          )
        })}
      </div>
      <p className="mt-2 truncate font-mono text-[7px] text-[#929ba4]">entity · {trace.entity ? shortId(trace.entity) : '입력 대기'}</p>
    </div>
  )
}

function PreviewMetric({ label, value }: { label: string; value: string }) {
  return (
    <dl className="rounded-md bg-[#f2f4f6] px-2 py-1.5">
      <dt className="truncate font-mono text-[6px] uppercase tracking-[.08em] text-[#9aa3ac]">{label}</dt>
      <dd className="mt-0.5 truncate font-mono text-[7px] font-semibold text-[#596570]">{value}</dd>
    </dl>
  )
}

function MemoryPreview({ nodes }: { nodes: MemoryNode[] }) {
  return (
    <div className="grid grid-cols-[54px_1fr] gap-2.5">
      <div className="flex flex-col items-center justify-center rounded-lg bg-[#f4f8f7] px-2 py-2">
        <div className="relative h-11 w-10" aria-hidden="true">
          {[3, 2, 1, 0].map((layer) => (
            <span
              key={layer}
              className="absolute left-1/2 h-4 w-9 -translate-x-1/2 rounded-[50%] border border-[#77b9a7] bg-[#e5f4ef] shadow-sm"
              style={{ top: `${layer * 7}px`, zIndex: 4 - layer }}
            />
          ))}
          <Database className="absolute left-1/2 top-1/2 z-10 size-5 -translate-x-1/2 -translate-y-1/2 text-[#17866d]" />
        </div>
        <span className="mt-1 font-mono text-[6px] uppercase tracking-[.08em] text-[#78848e]">append log</span>
      </div>
      <div className="space-y-1">
        {nodes.map((node, index) => (
          <div key={node.id} className={cn('grid grid-cols-[22px_1fr_auto] items-center gap-1.5 rounded-md border px-2 py-1.5', index === 0 ? 'border-[#bde0d6] bg-[#f0faf7]' : 'border-[#e3e7eb] bg-[#fafbfc]')}>
            <span className="font-mono text-[7px] font-semibold text-[#17866d]">L{node.level}</span>
            <span className="truncate text-[7px] text-[#69747f]">{node.displayText || structuralText(node)}</span>
            <i className={cn('size-1.5 rounded-full not-italic', index === 0 ? 'bg-[#25a77f]' : 'bg-[#cbd1d7]')} />
          </div>
        ))}
        {!nodes.length ? <p className="py-4 text-center text-[8px] text-[#929ba4]">첫 기억을 기다리는 중</p> : null}
      </div>
    </div>
  )
}

function RankPreview({ snapshot }: { snapshot: AdminDataPipelineSnapshot }) {
  const positions = [
    { x: 78, y: 31 },
    { x: 142, y: 28 },
    { x: 202, y: 54 },
    { x: 133, y: 91 },
  ]
  const nodes = snapshot.authorityNodes.slice(0, positions.length)
  const positioned = nodes.map((node, index) => ({ ...node, ...positions[index] }))
  const byId = new Map(positioned.map((node) => [node.id, node]))
  const edges = snapshot.authorityEdges.filter((candidate) => byId.has(candidate.source) && byId.has(candidate.target)).slice(0, 12)
  return (
    <svg viewBox="0 0 236 124" className="h-[124px] w-full rounded-md bg-[#f8fafb]" role="img" aria-label="질문별 Personalized PageRank 데이터 덱 그래프">
      <defs>
        <pattern id="pagerank-preview-dots" width="10" height="10" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".6" fill="#9aabb9" fillOpacity=".24" /></pattern>
        <filter id="deck-shadow" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="1" stdDeviation="1.2" floodColor="#1f2937" floodOpacity=".18" /></filter>
      </defs>
      <rect width="236" height="124" fill="url(#pagerank-preview-dots)" />
      {edges.map((candidate, index) => {
        const from = byId.get(candidate.source)!
        const to = byId.get(candidate.target)!
        return <line key={`${candidate.source}-${candidate.target}-${index}`} x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke={candidate.propagatesAuthority ? '#2c9e80' : '#aab3bc'} strokeOpacity={candidate.propagatesAuthority ? .78 : .34} strokeWidth={candidate.propagatesAuthority ? 1.5 : .8} />
      })}
      {positioned.map((node) => node.teleportWeight > 0 ? (
        <line key={`seed-${node.id}`} x1="24" y1="62" x2={node.x - 14} y2={node.y} stroke="#8976c6" strokeOpacity=".68" strokeWidth="1.1" strokeDasharray="3 3" />
      ) : null)}
      <g>
        <circle cx="24" cy="62" r="12" fill="#30363d" />
        <text x="24" y="60" textAnchor="middle" fontSize="6" fill="white" fontWeight="700">QUERY</text>
        <text x="24" y="68" textAnchor="middle" fontSize="4.5" fill="#cdd4da">seed</text>
      </g>
      {positioned.map((node, index) => (
        <g key={node.id}>
          {index === 0 ? <circle cx={node.x} cy={node.y} r="20" fill="#35a98a" opacity=".12" className="animate-pulse" /> : null}
          <g transform={`translate(${node.x - 14} ${node.y - 11})`} filter="url(#deck-shadow)">
            <title>{`${node.handle} · authority ${(node.authority * 100).toFixed(2)}% · teleport ${(node.teleportWeight * 100).toFixed(2)}%`}</title>
            <path d="M2 14 14 20 26 14 14 8Z" fill={node.teleportWeight > 0 ? '#9c8bd0' : '#69b9a3'} opacity=".58" />
            <path d="M2 10 14 16 26 10 14 4Z" fill={node.teleportWeight > 0 ? '#8a76c5' : '#3ea68a'} opacity=".8" />
            <path d="M2 6 14 12 26 6 14 0Z" fill={index === 0 ? '#16866d' : node.teleportWeight > 0 ? '#765fb7' : '#258f75'} />
            <text x="14" y="29" textAnchor="middle" fontSize="5.5" fill="#52606b" fontWeight="600">{(node.authority * 100).toFixed(1)}%</text>
            <text x="14" y="36" textAnchor="middle" fontSize="4.5" fill="#8b959e">{node.category.slice(0, 8)}</text>
          </g>
        </g>
      ))}
      {!nodes.length ? <text x="118" y="66" textAnchor="middle" fontSize="7" fill="#98a1aa">검색 결과를 기다리는 중</text> : null}
      <text x="8" y="116" fontSize="4.8" fill="#909aa3">점선: 질문 seed · 실선: 검증된 권위 전파 · 숫자: 질문별 authority</text>
    </svg>
  )
}

function RankedPreview({ nodes }: { nodes: AdminDataPipelineSnapshot['authorityNodes'] }) {
  return (
    <div className="space-y-1.5">
      {nodes.map((node, index) => (
        <div key={node.id} className="flex items-center gap-2 border-b border-[#e7eaee] pb-1.5 last:border-0 last:pb-0">
          <span className="grid size-4 shrink-0 place-items-center rounded-full bg-[#edf8f4] text-[7px] font-semibold text-[#16836b]">{index + 1}</span>
          <span className="min-w-0 flex-1 truncate text-[8px] font-medium text-[#46515c]">{node.handle}</span>
          <span className="font-mono text-[7px] text-[#16836b]">{(node.authority * 100).toFixed(1)}%</span>
        </div>
      ))}
      {!nodes.length ? <p className="text-[8px] text-[#929ba4]">검색 결과 대기</p> : null}
    </div>
  )
}

function buildAbstractionTrace(snapshot: AdminDataPipelineSnapshot) {
  const groups = new Map<string, MemoryNode[]>()
  for (const node of snapshot.memoryNodes) {
    const group = groups.get(node.entity) ?? []
    group.push(node)
    groups.set(node.entity, group)
  }
  const selected = [...groups.entries()].sort(([, left], [, right]) => {
    const leftOwned = left.some((node) => node.ownedByViewer) ? 1 : 0
    const rightOwned = right.some((node) => node.ownedByViewer) ? 1 : 0
    const leftLevel = Math.max(...left.map((node) => node.level))
    const rightLevel = Math.max(...right.map((node) => node.level))
    const leftTime = Math.max(...left.map((node) => node.createdAt))
    const rightTime = Math.max(...right.map((node) => node.createdAt))
    return rightOwned - leftOwned || rightLevel - leftLevel || rightTime - leftTime
  })[0]
  const levels = new Map<number, MemoryNode[]>()
  if (selected) {
    for (const node of selected[1].sort((left, right) => right.createdAt - left.createdAt)) {
      const bucket = levels.get(node.level) ?? []
      bucket.push(node)
      levels.set(node.level, bucket)
    }
  }
  return { entity: selected?.[0] ?? null, levels }
}

function structuralText(node: MemoryNode) {
  return node.level === 0 ? `${node.shelf} 분야의 검증된 원문 관측` : `L${node.level} 추상화 · 근거 ${node.sourceCount}개 연결`
}

function shortId(value: string) {
  return value.length > 12 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value
}

function formatClock(timestamp: number) {
  return new Intl.DateTimeFormat('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(timestamp)
}
