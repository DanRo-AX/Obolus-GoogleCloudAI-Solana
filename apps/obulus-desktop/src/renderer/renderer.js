const byId = (id) => document.getElementById(id)
const state = {
  conversations: [],
  currentConversationId: null,
  activeRunId: null,
  activeAssistant: null,
  toolCards: new Map(),
  activity: new Map(),
  toolCalls: 0,
  pendingIntentId: null,
  pendingPaymentPurpose: null,
}

const toolLabels = {
  local_privacy_status: '로컬 보안 경계 확인',
  search_human_evidence: '인간 경험 DB 검색',
  generate_ai_baseline: '무료 AI 기준선 생성',
  prepare_evidence_payment: '근거 결제 조건 고정',
  evidence_payment_status: '결제·전달 상태 확인',
  synthesize_paid_evidence: '결제된 근거 합성',
  forget_local_query: '로컬 질의 데이터 삭제',
  account_status: 'Obulus 계정 확인',
  prepare_open_call: 'Open Call 조건·에스크로 준비',
  open_call_status: 'Open Call 진행 확인',
  cancel_open_call: 'Open Call 취소',
  submit_document_feedback: '구매 근거 평가',
  get_profile: '프로필 조회',
  update_profile: '프로필 수정',
  prepare_payout_wallet_link: '정산 지갑 연결 준비',
  update_preferences: '데이터 사용 설정 변경',
  list_opportunities: '참여 가능한 공고 검색',
  manage_reservation: '응답 자리 관리',
  submit_human_answer: '직접 작성한 경험 제출',
  shelf_starters: '메모리 시작 질문 조회',
  answer_shelf_starter: '메모리 경험 추가',
  notifications: '알림 조회·확인',
  manage_memory: '개인 메모리 조회·관리',
  earnings_and_claims: '수익·정산 내역 확인',
  account_data: '계정 데이터 내보내기·삭제',
  lookup_contributor: '기여자 공개 정보 조회',
}

document.addEventListener('DOMContentLoaded', async () => {
  bindEvents()
  window.obulus.onAgentEvent(handleAgentEvent)
  await bootstrap()
})

function bindEvents() {
  byId('new-chat').addEventListener('click', newConversation)
  byId('composer').addEventListener('submit', (event) => {
    event.preventDefault()
    sendCurrentMessage()
  })
  byId('message-input').addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault()
      sendCurrentMessage()
    }
  })
  byId('message-input').addEventListener('input', resizeComposer)
  byId('stop-agent').addEventListener('click', stopAgent)
  byId('conversation-search').addEventListener('input', renderConversationList)
  byId('open-settings').addEventListener('click', () => byId('settings-dialog').showModal())
  byId('open-tools').addEventListener('click', () => byId('settings-dialog').showModal())
  byId('toggle-inspector').addEventListener('click', () => byId('inspector').classList.toggle('open'))
  byId('close-inspector').addEventListener('click', () => byId('inspector').classList.remove('open'))
  document.querySelectorAll('.close-dialog').forEach((button) => {
    button.addEventListener('click', () => button.closest('dialog')?.close())
  })
  document.querySelectorAll('.prompt-card').forEach((button) => {
    button.addEventListener('click', () => {
      byId('message-input').value = button.dataset.prompt
      resizeComposer()
      sendCurrentMessage()
    })
  })
  byId('save-claude-key').addEventListener('click', saveClaudeKey)
  byId('remove-claude-key').addEventListener('click', removeClaudeKey)
  byId('create-pay-account').addEventListener('click', createPayAccount)
  byId('connect-obulus-account').addEventListener('click', connectAccount)
  byId('disconnect-obulus-account').addEventListener('click', disconnectAccount)
  document.querySelectorAll('.install-mcp').forEach((button) => {
    button.addEventListener('click', () => installMcp(button.dataset.client, button))
  })
  byId('execute-payment').addEventListener('click', executePayment)
}

async function bootstrap() {
  try {
    const result = await window.obulus.bootstrap()
    state.conversations = result.conversations || []
    renderConversationList()
    updateRuntime(result.doctor)
    if (!result.doctor.ai?.configured) byId('settings-dialog').showModal()
  } catch (error) {
    showSystem(`앱 초기화에 실패했습니다: ${error.message}`)
    setText('api-status', '연결 실패')
    setText('api-chip', '연결 확인 필요')
  }
}

function updateRuntime(report) {
  const apiReady = report.api?.ok && report.gateway?.ok
  setText('api-status', apiReady ? '준비됨' : '확인 필요')
  setText('api-chip', apiReady ? 'Obulus 연결됨' : '연결 확인 필요')
  byId('api-chip').classList.toggle('ready', apiReady)
  setText('ai-status', report.ai?.configured ? report.ai.model : '설정 필요')
  setText('pay-status', report.paySh?.ok ? '준비됨' : '확인 필요')
  setText('pay-account-status', report.payAccount?.ok ? report.payAccount.account : '생성 필요')
  setText(
    'account-status',
    report.privacy?.contributorSessionConnected ? 'Pay.sh 지갑 연결됨' : '연결 안 됨',
  )
}

async function refreshRuntime() {
  try { updateRuntime(await window.obulus.doctor()) } catch (error) { settingsStatus(error.message) }
}

async function newConversation() {
  if (state.activeRunId) return
  state.currentConversationId = null
  state.activeAssistant = null
  state.toolCards.clear()
  byId('messages').replaceChildren()
  byId('empty-state').classList.remove('hidden')
  setText('conversation-title', '새 리서치')
  setText('conversation-subtitle', '사람의 경험을 검색하고 필요한 근거만 결제합니다')
  document.querySelectorAll('.conversation-item').forEach((item) => item.classList.remove('active'))
  byId('message-input').focus()
}

async function loadConversation(id) {
  if (state.activeRunId || id === state.currentConversationId) return
  try {
    const conversation = await window.obulus.getConversation(id)
    state.currentConversationId = id
    state.activeAssistant = null
    state.toolCards.clear()
    byId('messages').replaceChildren()
    byId('empty-state').classList.add('hidden')
    setText('conversation-title', conversation.title)
    setText('conversation-subtitle', `${conversation.messages.length}개 기록 · 로컬 저장`)
    for (const message of conversation.messages) renderStoredMessage(message)
    renderConversationList()
    scrollToBottom()
  } catch (error) {
    showSystem(error.message)
  }
}

function renderStoredMessage(message) {
  if (message.role === 'tool') {
    const card = createToolCard(message.toolUseId || message.id, message.toolName, {})
    finishToolCard(card, safeParse(message.text), message.status === 'error')
    return
  }
  appendMessage(message.role, message.text)
}

async function deleteConversation(id, event) {
  event.stopPropagation()
  if (state.activeRunId) return
  try {
    await window.obulus.deleteConversation(id)
    state.conversations = state.conversations.filter((item) => item.id !== id)
    if (state.currentConversationId === id) await newConversation()
    renderConversationList()
  } catch (error) { showSystem(error.message) }
}

function renderConversationList() {
  const query = byId('conversation-search').value.trim().toLowerCase()
  const list = byId('conversation-list')
  list.replaceChildren()
  state.conversations
    .filter((conversation) => !query || conversation.title.toLowerCase().includes(query))
    .forEach((conversation) => {
      const wrap = document.createElement('div')
      wrap.className = 'conversation-wrap'
      const button = document.createElement('button')
      button.type = 'button'
      button.className = `conversation-item${conversation.id === state.currentConversationId ? ' active' : ''}`
      button.textContent = conversation.title
      button.addEventListener('click', () => loadConversation(conversation.id))
      const remove = document.createElement('button')
      remove.type = 'button'
      remove.className = 'conversation-delete'
      remove.textContent = '×'
      remove.setAttribute('aria-label', '대화 삭제')
      remove.addEventListener('click', (event) => deleteConversation(conversation.id, event))
      wrap.append(button, remove)
      list.append(wrap)
    })
}

async function sendCurrentMessage() {
  const input = byId('message-input')
  const message = input.value.trim()
  if (!message || state.activeRunId) return
  input.value = ''
  resizeComposer()
  await runAgentMessage(message)
}

async function runAgentMessage(message) {
  try {
    if (!state.currentConversationId) {
      const conversation = await window.obulus.createConversation()
      state.currentConversationId = conversation.id
    }
    byId('empty-state').classList.add('hidden')
    appendMessage('user', message)
    setRunning(true)
    state.activeAssistant = null
    const result = await window.obulus.runAgent({
      conversationId: state.currentConversationId,
      message,
    })
    state.activeRunId = result.runId
  } catch (error) {
    setRunning(false)
    showSystem(error.message)
    if (error.code === 'claude_not_configured') byId('settings-dialog').showModal()
  }
}

async function stopAgent() {
  if (!state.activeRunId) return
  try { await window.obulus.cancelAgent(state.activeRunId) } catch (error) { showSystem(error.message) }
}

function handleAgentEvent(event) {
  if (state.activeRunId && event.runId !== state.activeRunId) return
  if (!state.activeRunId) state.activeRunId = event.runId
  switch (event.type) {
    case 'conversation':
      state.currentConversationId = event.conversationId
      break
    case 'thinking':
      state.activeAssistant = null
      showThinking()
      break
    case 'text_delta':
      appendAssistantDelta(event.text)
      break
    case 'tool_start':
      removeThinking()
      createToolCard(event.toolUseId, event.toolName, event.input)
      addActivity(event)
      break
    case 'tool_result': {
      const card = state.toolCards.get(event.toolUseId)
      finishToolCard(card, event.result, event.isError)
      finishActivity(event)
      if (!event.isError && ['prepare_evidence_payment', 'prepare_open_call'].includes(event.toolName)) {
        const intentId = event.result?.intentId
        if (intentId) addPaymentRequest(card, intentId, event.result?.purpose)
      }
      break
    }
    case 'complete':
      finishRun()
      break
    case 'cancelled':
      showSystem('작업을 중지했습니다.')
      finishRun()
      break
    case 'error':
      showSystem(event.error || '에이전트 실행에 실패했습니다.')
      finishRun()
      if (event.code === 'claude_not_configured') byId('settings-dialog').showModal()
      break
  }
  scrollToBottom()
}

function showThinking() {
  removeThinking()
  const row = document.createElement('div')
  row.id = 'thinking-line'
  row.className = 'thinking-line'
  row.append(document.createElement('i'), document.createTextNode('다음 단계와 필요한 도구를 판단하고 있습니다'))
  byId('messages').append(row)
}

function removeThinking() { byId('thinking-line')?.remove() }

function appendAssistantDelta(text) {
  removeThinking()
  if (!state.activeAssistant) state.activeAssistant = appendMessage('assistant', '', true)
  state.activeAssistant.querySelector('.message-body').textContent += text
}

function appendMessage(role, text, streaming = false) {
  const row = document.createElement('article')
  row.className = `message ${role}${streaming ? ' streaming' : ''}`
  const body = document.createElement('div')
  body.className = 'message-body'
  body.textContent = text
  if (role === 'assistant') {
    const head = document.createElement('div')
    head.className = 'message-head'
    const mark = document.createElement('span')
    mark.className = 'message-agent-mark'
    mark.innerHTML = '<svg class="obulus-glyph" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10.5" fill="none" stroke="currentColor" stroke-width="2"/><rect x="5" y="16.2" width="14" height="2.1" fill="currentColor"/><rect x="6.5" y="7.6" width="2.5" height="8.6" fill="currentColor"/><rect x="9.8" y="9.2" width="2.5" height="7" fill="currentColor"/><path d="M15.4 8L17.75 8.65L15.55 16.2L13.2 15.55Z" fill="currentColor"/></svg>'
    const label = document.createElement('span')
    label.textContent = 'OBULUS AGENT'
    head.append(mark, label)
    row.append(head, body)
  } else row.append(body)
  byId('messages').append(row)
  return row
}

function createToolCard(id, name, input) {
  const card = document.createElement('article')
  card.className = 'tool-card'
  card.dataset.toolUseId = id
  const header = document.createElement('div')
  header.className = 'tool-card-header'
  const icon = document.createElement('span')
  icon.className = 'tool-icon'
  icon.textContent = '↳'
  const title = document.createElement('strong')
  title.className = 'tool-title'
  title.textContent = toolLabels[name] || name || '도구 실행'
  const status = document.createElement('span')
  status.className = 'tool-state'
  status.textContent = '실행 중'
  const body = document.createElement('div')
  body.className = 'tool-card-body'
  body.textContent = compactJson(input)
  header.append(icon, title, status)
  card.append(header, body)
  byId('messages').append(card)
  state.toolCards.set(id, card)
  return card
}

function finishToolCard(card, result, isError) {
  if (!card) return
  card.classList.toggle('error', Boolean(isError))
  card.querySelector('.tool-state').textContent = isError ? '확인 필요' : '완료'
  card.querySelector('.tool-card-body').textContent = summarizeResult(result)
}

function addPaymentRequest(card, intentId, purpose) {
  if (!card || card.querySelector('.payment-request')) return
  const request = document.createElement('div')
  request.className = 'payment-request'
  const copy = document.createElement('div')
  const title = document.createElement('strong')
  title.textContent = '사용자 승인이 필요한 결제입니다'
  const detail = document.createElement('span')
  detail.textContent = purpose || '정확한 문서와 금액을 확인하세요.'
  copy.append(title, detail)
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'primary-button'
  button.textContent = '조건 확인'
  button.addEventListener('click', () => openPayment(intentId, purpose))
  request.append(copy, button)
  card.append(request)
}

function addActivity(event) {
  byId('activity-list').querySelector('.activity-empty')?.remove()
  state.toolCalls += 1
  setText('tool-count', `${state.toolCalls} calls`)
  const item = document.createElement('div')
  item.className = 'activity-item'
  const title = document.createElement('strong')
  title.textContent = toolLabels[event.toolName] || event.toolName
  const status = document.createElement('span')
  status.textContent = '실행 중'
  item.append(title, status)
  byId('activity-list').prepend(item)
  state.activity.set(event.toolUseId, item)
}

function finishActivity(event) {
  const item = state.activity.get(event.toolUseId)
  if (item) item.querySelector('span').textContent = event.isError ? '오류 · 확인 필요' : '완료'
}

async function finishRun() {
  removeThinking()
  state.activeAssistant?.classList.remove('streaming')
  state.activeAssistant = null
  state.activeRunId = null
  setRunning(false)
  try {
    state.conversations = await window.obulus.listConversations()
    renderConversationList()
    const current = state.conversations.find((item) => item.id === state.currentConversationId)
    if (current) {
      setText('conversation-title', current.title)
      setText('conversation-subtitle', `${current.messageCount}개 기록 · 로컬 저장`)
    }
  } catch {}
}

function setRunning(active) {
  byId('send-message').classList.toggle('hidden', active)
  byId('stop-agent').classList.toggle('hidden', !active)
  byId('message-input').disabled = active
}

async function openPayment(intentId, purpose) {
  try {
    const preview = await window.obulus.paymentPreview(intentId)
    state.pendingIntentId = intentId
    state.pendingPaymentPurpose = purpose || preview.purpose
    const entries = preview.openCallTarget
      ? [
          ['용도', preview.purpose],
          ['응답자', `${preview.openCallTarget}명 × ${formatKrw(preview.openCallUnitPriceKrw)}`],
          ['총 에스크로', `${preview.amountUsdc} Devnet USDC · ${formatKrw(preview.totalPriceKrw)}`],
          ['수취 경계', preview.recipient],
          ['네트워크', preview.network],
          ['Pay.sh 계정', preview.payAccount],
        ]
      : [
          ['용도', preview.purpose],
          ['인간 근거', `${preview.documentCount}개 · ${preview.documentHandles.join(', ')}`],
          ['총 결제액', `${preview.amountUsdc} Devnet USDC · ${formatKrw(preview.totalPriceKrw)}`],
          ['수취인', preview.recipient],
          ['네트워크', preview.network],
          ['Pay.sh 계정', preview.payAccount],
        ]
    const details = byId('payment-details')
    details.replaceChildren()
    entries.forEach(([key, value]) => {
      const dt = document.createElement('dt')
      const dd = document.createElement('dd')
      dt.textContent = key
      dd.textContent = value
      details.append(dt, dd)
    })
    byId('confirmation').value = ''
    byId('confirmation').placeholder = preview.confirmationPhrase
    byId('payment-dialog').dataset.phrase = preview.confirmationPhrase
    setText('payment-status', '')
    byId('payment-dialog').showModal()
  } catch (error) { showSystem(error.message) }
}

async function executePayment() {
  const button = byId('execute-payment')
  setButtonBusy(button, true, 'Pay.sh 승인 대기…')
  try {
    const receipt = await window.obulus.approveAndPay(
      state.pendingIntentId,
      byId('confirmation').value.trim(),
    )
    setText('payment-status', '정확한 조건의 결제가 확인되었습니다.')
    setTimeout(() => byId('payment-dialog').close(), 500)
    showSystem('Pay.sh 결제가 완료되었습니다. Agent가 전달 상태를 검증하고 다음 작업을 계속합니다.')
    await runAgentMessage(
      `방금 승인한 “${state.pendingPaymentPurpose || 'Obulus 결제'}”가 완료되었습니다. 다음 결제를 새로 만들지 말고, 기존 결제의 상태를 확인한 뒤 가능한 경우 결제된 근거만 합성하거나 Open Call 상태를 알려줘. 결제 영수증: ${JSON.stringify(receipt.receipt)}`,
    )
  } catch (error) {
    setText('payment-status', error.message)
  } finally {
    setButtonBusy(button, false, '로컬 Pay.sh로 결제')
  }
}

async function saveClaudeKey() {
  const button = byId('save-claude-key')
  setButtonBusy(button, true, '암호화 중…')
  try {
    const status = await window.obulus.saveClaudeKey(byId('claude-key').value)
    byId('claude-key').value = ''
    settingsStatus(`${status.model} 연결 정보가 이 기기의 보안 저장소에 저장되었습니다.`)
    await refreshRuntime()
  } catch (error) { settingsStatus(error.message) }
  finally { setButtonBusy(button, false, '암호화해 저장') }
}

async function removeClaudeKey() {
  try {
    await window.obulus.saveClaudeKey('')
    settingsStatus('저장된 Claude API 키를 제거했습니다.')
    await refreshRuntime()
  } catch (error) { settingsStatus(error.message) }
}

async function createPayAccount() {
  const button = byId('create-pay-account')
  setButtonBusy(button, true, 'OS 보안 저장소 확인 중…')
  try {
    const result = await window.obulus.createPayAccount()
    settingsStatus(`${result.account} Pay.sh 계정을 생성했습니다. 개인키는 내보내지 않았습니다.`)
    await refreshRuntime()
  } catch (error) { settingsStatus(error.message) }
  finally { setButtonBusy(button, false, '로컬 Pay.sh 계정 만들기') }
}

async function connectAccount() {
  const button = byId('connect-obulus-account')
  setButtonBusy(button, true, 'Pay.sh 서명 대기…')
  try {
    const result = await window.obulus.connectAccount({ ageConfirmed14: byId('age-confirmed').checked })
    settingsStatus(`${shortAddress(result.wallet)} 지갑으로 Obulus 계정에 연결했습니다.`)
    await refreshRuntime()
  } catch (error) { settingsStatus(error.message) }
  finally { setButtonBusy(button, false, 'Pay.sh 서명으로 Obulus 로그인') }
}

async function disconnectAccount() {
  try {
    await window.obulus.disconnectAccount()
    settingsStatus('Obulus 계정 세션을 이 기기에서 제거했습니다.')
    await refreshRuntime()
  } catch (error) { settingsStatus(error.message) }
}

async function installMcp(client, button) {
  setButtonBusy(button, true, '설치 중…')
  try {
    const result = await window.obulus.installMcp(client, {
      includeOfficialPay: byId('include-official-pay').checked,
    })
    const changed = result.filter((item) => ['installed', 'updated'].includes(item.status)).length
    settingsStatus(`${client === 'codex' ? 'Codex' : 'Claude'}에 ${changed}개 MCP 연결을 안전한 최신 설정으로 등록했습니다.`)
  } catch (error) { settingsStatus(error.message) }
  finally { setButtonBusy(button, false, `${client === 'codex' ? 'Codex' : 'Claude'}에 설치`) }
}

function showSystem(text) {
  byId('empty-state').classList.add('hidden')
  const element = document.createElement('div')
  element.className = 'system-message'
  element.textContent = text
  byId('messages').append(element)
  scrollToBottom()
}

function summarizeResult(result) {
  if (!result || typeof result !== 'object') return String(result ?? '완료')
  if (result.error) return result.error.message || compactJson(result.error)
  if (Array.isArray(result.matches)) {
    const decision = result.decision === 'hit' ? '기존 근거 HIT' : '근거 부족 MISS'
    const rows = result.matches.slice(0, 8).map((match) =>
      `${match.handle} · ${match.category || '경험'} · ${formatKrw(match.priceKrw)} · 적합도 ${Math.round(Number(match.score || 0) * 100)}%`,
    )
    return `${decision} · ${result.candidateCount ?? result.matches.length}개 후보\n${rows.join('\n')}`
  }
  if (result.intentId) {
    const quote = result.quote || {}
    return `결제 전 검증 완료\n의도: ${result.intentId}\n금액: ${quote.totalPriceKrw ? formatKrw(quote.totalPriceKrw) : quote.priceKrw ? formatKrw(quote.priceKrw) : quote.amountAtomic || '확인 필요'}\n사용자 승인 전에는 서명되지 않습니다.`
  }
  if (result.connected !== undefined) return result.connected ? '로컬 지갑 계정이 연결되어 있습니다.' : result.nextAction || '계정 연결이 필요합니다.'
  return compactJson(result)
}

function compactJson(value) {
  if (!value || (typeof value === 'object' && Object.keys(value).length === 0)) return '입력 조건 없음'
  const text = JSON.stringify(value, null, 2)
  return text.length > 5000 ? `${text.slice(0, 5000)}\n…` : text
}

function safeParse(value) { try { return JSON.parse(value) } catch { return value } }
function formatKrw(value) { return Number.isFinite(Number(value)) ? `${Number(value).toLocaleString('ko-KR')}원` : '가격 확인 필요' }
function shortAddress(value) { return value?.length > 12 ? `${value.slice(0,6)}…${value.slice(-4)}` : value || '지갑' }
function setText(id, value) { byId(id).textContent = value }
function settingsStatus(value) { setText('settings-status', value) }
function setButtonBusy(button, active, label) { button.disabled = active; button.textContent = label }
function resizeComposer() { const input = byId('message-input'); input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight,160)}px` }
function scrollToBottom() { requestAnimationFrame(() => { const pane = byId('chat-scroll'); pane.scrollTop = pane.scrollHeight }) }
