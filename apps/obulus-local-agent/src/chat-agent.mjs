import Anthropic from '@anthropic-ai/sdk'

import {
  appendConversationMessages,
  createConversation,
  getConversation,
} from './conversations.mjs'
import { LocalAgentError } from './errors.mjs'
import { protectAgentMessage, redactModelSecrets } from './privacy.mjs'

const MAX_TOOL_ROUNDS = 8
const MAX_TOOL_RESULT_CHARS = 48_000

const systemPrompt = `당신은 Obulus의 인간 경험 리서치 에이전트입니다.

목표는 사용자의 질문을 실제 사람의 동의된 경험 데이터로 조사하는 것입니다. 다음 원칙은 예외가 없습니다.
- 먼저 무료 메타데이터를 검색하고, 질문과 관련된 최소한의 독립 근거만 선택합니다.
- AI baseline은 일반적인 방향 제시일 뿐 인간 근거라고 부르지 않습니다.
- 사람의 답변, 경험, 인용을 지어내지 않습니다. 결제되고 서버가 검증한 passage만 인간 근거로 인용합니다.
- 결제 도구는 정확한 의도만 준비합니다. 사용자 승인 없이 결제를 실행했다고 말하지 않습니다.
- Open Call 답변과 메모리 정정은 사용자가 직접 쓴 문장을 그대로 전달하며 대신 작성하거나 경험을 가장하지 않습니다.
- 계정 삭제, 로컬 데이터 삭제, 공고 취소처럼 되돌리기 어려운 작업은 도구가 요구하는 정확한 확인 문구가 사용자 메시지에 있을 때만 실행합니다.
- 도구 호출 중에는 무엇을 확인하는지 짧고 구체적으로 설명하고, 결과에는 표본 범위·한계·비용·출처를 분명히 적습니다.
- 전문 용어를 먼저 내세우지 말고, 사용자가 얻는 결과를 자연스러운 한국어로 설명합니다.`

export class ObulusChatAgent {
  constructor(runtime, options = {}) {
    this.runtime = runtime
    this.clientFactory = options.clientFactory || defaultClientFactory
    this.maxToolRounds = options.maxToolRounds || MAX_TOOL_ROUNDS
  }

  status() {
    const config = this.runtime.config
    return {
      configured: Boolean(config.anthropicApiKey),
      model: config.anthropicModel,
      endpoint: config.anthropicBaseUrl ? 'Obulus Claude gateway' : 'Anthropic API',
      keyStorage: 'OS-protected local storage or process environment',
    }
  }

  async run({ conversationId, message, onEvent = () => {}, signal } = {}) {
    const userText = protectAgentMessage(String(message || ''))
    if (!this.runtime.config.anthropicApiKey) {
      throw new LocalAgentError(
        'Claude API가 설정되지 않았습니다. 앱 설정에서 API 키를 저장하세요.',
        'claude_not_configured',
        409,
      )
    }

    const conversation = conversationId
      ? await getConversation(this.runtime.config, conversationId)
      : await createConversation(this.runtime.config)
    const id = conversation.id
    const userMessage = { role: 'user', text: userText, createdAt: Date.now() }
    await appendConversationMessages(this.runtime.config, id, [userMessage])
    emit(onEvent, { type: 'conversation', conversationId: id })

    const current = await getConversation(this.runtime.config, id)
    const messages = toAnthropicHistory(current.messages)
    const client = this.clientFactory(this.runtime.config)
    const tools = this.runtime.listTools().map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema,
    }))
    const persisted = []

    for (let round = 0; round < this.maxToolRounds; round += 1) {
      throwIfAborted(signal)
      emit(onEvent, { type: 'thinking', round: round + 1 })
      const response = await streamMessage(
        client,
        {
          model: this.runtime.config.anthropicModel,
          max_tokens: 4_096,
          system: systemPrompt,
          messages,
          tools,
        },
        (text) => emit(onEvent, { type: 'text_delta', text }),
        signal,
      )

      const assistantContent = response.content || []
      messages.push({ role: 'assistant', content: assistantContent })
      const assistantText = assistantContent
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('')
      if (assistantText) {
        const stored = { role: 'assistant', text: assistantText, createdAt: Date.now() }
        persisted.push(stored)
        await appendConversationMessages(this.runtime.config, id, [stored])
      }

      const toolUses = assistantContent.filter((block) => block.type === 'tool_use')
      if (!toolUses.length) {
        emit(onEvent, { type: 'complete', conversationId: id, stopReason: response.stop_reason })
        return { conversationId: id, messages: persisted, stopReason: response.stop_reason }
      }

      const toolResults = []
      for (const toolUse of toolUses) {
        throwIfAborted(signal)
        emit(onEvent, {
          type: 'tool_start',
          toolUseId: toolUse.id,
          toolName: toolUse.name,
          input: toolUse.input,
        })
        let result
        let isError = false
        try {
          result = await this.runtime.callTool(toolUse.name, toolUse.input || {})
        } catch (error) {
          isError = true
          result = {
            error: {
              code: error?.code || 'tool_error',
              message: error?.message || '도구 실행에 실패했습니다.',
            },
          }
        }
        result = redactModelSecrets(result)
        const serialized = limitedJson(result)
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: serialized,
          is_error: isError,
        })
        const stored = {
          role: 'tool',
          text: serialized,
          toolName: toolUse.name,
          toolUseId: toolUse.id,
          status: isError ? 'error' : 'complete',
          createdAt: Date.now(),
        }
        persisted.push(stored)
        await appendConversationMessages(this.runtime.config, id, [stored])
        emit(onEvent, {
          type: 'tool_result',
          toolUseId: toolUse.id,
          toolName: toolUse.name,
          result,
          isError,
        })
      }
      messages.push({ role: 'user', content: toolResults })
    }
    throw new LocalAgentError(
      '에이전트가 허용된 도구 실행 횟수를 초과했습니다.',
      'tool_round_limit',
      409,
    )
  }
}

function defaultClientFactory(config) {
  return new Anthropic({
    apiKey: config.anthropicApiKey,
    ...(config.anthropicBaseUrl ? { baseURL: config.anthropicBaseUrl } : {}),
  })
}

async function streamMessage(client, params, onText, signal) {
  const stream = client.messages.stream(params, { signal })
  stream.on('text', onText)
  return stream.finalMessage()
}

function toAnthropicHistory(messages) {
  return messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .slice(-40)
    .map((message) => ({ role: message.role, content: message.text }))
}

function limitedJson(value) {
  const serialized = JSON.stringify(value)
  if (serialized.length <= MAX_TOOL_RESULT_CHARS) return serialized
  return JSON.stringify({
    truncated: true,
    preview: serialized.slice(0, MAX_TOOL_RESULT_CHARS),
    instruction: '결과가 너무 커서 일부만 전달되었습니다. 범위를 좁혀 다시 조회하세요.',
  })
}

function emit(handler, event) {
  handler({ ...event, at: Date.now() })
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw new DOMException('요청이 취소되었습니다.', 'AbortError')
}
