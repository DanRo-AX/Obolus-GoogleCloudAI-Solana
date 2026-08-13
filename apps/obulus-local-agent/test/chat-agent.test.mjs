import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { ObulusChatAgent } from '../src/chat-agent.mjs'
import { getConversation } from '../src/conversations.mjs'

test('Claude streams text, chooses an Obulus tool, and continues with its result', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'obulus-chat-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const responses = [
    {
      text: '먼저 무료 메타데이터를 검색하겠습니다. ',
      content: [
        { type: 'text', text: '먼저 무료 메타데이터를 검색하겠습니다. ' },
        {
          type: 'tool_use',
          id: 'tool_1',
          name: 'search_human_evidence',
          input: { question: '파리 직장인의 평일 저녁 식사 경험을 찾아줘' },
        },
      ],
      stop_reason: 'tool_use',
    },
    {
      text: '관련 있는 인간 근거 후보 2개를 찾았습니다.',
      content: [{ type: 'text', text: '관련 있는 인간 근거 후보 2개를 찾았습니다.' }],
      stop_reason: 'end_turn',
    },
  ]
  const calls = []
  const events = []
  const runtime = {
    config: {
      statePath: join(directory, 'state.json'),
      anthropicApiKey: 'sk-ant-test-abcdefghijklmnopqrstuvwxyz',
      anthropicModel: 'claude-test',
      anthropicBaseUrl: null,
    },
    listTools: () => [
      {
        name: 'search_human_evidence',
        description: 'Search',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      },
    ],
    callTool: async (name, input) => {
      calls.push({ name, input })
      return { decision: 'hit', candidateCount: 2, sessionToken: 'must-never-reach-model' }
    },
  }
  const agent = new ObulusChatAgent(runtime, {
    clientFactory: () => ({
      messages: {
        stream: () => {
          const response = responses.shift()
          let textHandler = () => {}
          return {
            on(event, handler) {
              if (event === 'text') textHandler = handler
              return this
            },
            async finalMessage() {
              textHandler(response.text)
              return response
            },
          }
        },
      },
    }),
  })

  const result = await agent.run({
    message: '파리 직장인의 평일 저녁 식사 경험을 찾아줘',
    onEvent: (event) => events.push(event),
  })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].name, 'search_human_evidence')
  assert.equal(events.some((event) => event.type === 'text_delta'), true)
  assert.equal(events.some((event) => event.type === 'tool_start'), true)
  assert.equal(events.some((event) => event.type === 'tool_result'), true)
  assert.equal(events.at(-1).type, 'complete')
  const stored = await getConversation(runtime.config, result.conversationId)
  assert.deepEqual(stored.messages.map((message) => message.role), [
    'user',
    'assistant',
    'tool',
    'assistant',
  ])
  assert.equal(stored.messages[2].text.includes('must-never-reach-model'), false)
  assert.match(stored.messages[2].text, /redacted local secret/)
})

test('chat agent refuses to run without locally configured Claude credentials', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'obulus-chat-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const agent = new ObulusChatAgent({
    config: { statePath: join(directory, 'state.json'), anthropicApiKey: '' },
  })
  await assert.rejects(
    agent.run({ message: '실제 사람들의 경험을 찾아줘' }),
    (error) => error.code === 'claude_not_configured',
  )
})

test('chat agent blocks direct identifiers before writing or sending them to Claude', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'obulus-chat-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  let clientCreated = false
  const runtime = {
    config: {
      statePath: join(directory, 'state.json'),
      anthropicApiKey: 'sk-ant-test-abcdefghijklmnopqrstuvwxyz',
      anthropicModel: 'claude-test',
    },
    listTools: () => [],
  }
  const agent = new ObulusChatAgent(runtime, {
    clientFactory: () => {
      clientCreated = true
      return {}
    },
  })
  await assert.rejects(
    agent.run({ message: 'lee@example.com의 구매 내역을 조사해줘' }),
    (error) => error.code === 'sensitive_agent_message_blocked',
  )
  assert.equal(clientCreated, false)
})
