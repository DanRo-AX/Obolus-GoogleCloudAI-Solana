import { randomUUID } from 'node:crypto'

import {
  MAX_CONVERSATIONS,
  MAX_CONVERSATION_MESSAGES,
} from './constants.mjs'
import { LocalAgentError } from './errors.mjs'
import { readState, updateState } from './state.mjs'

const MAX_MESSAGE_TEXT = 80_000

export async function createConversation(config, options = {}) {
  const now = options.now?.() ?? Date.now()
  const id = `conversation_${randomUUID()}`
  const conversation = {
    id,
    title: cleanTitle(options.title || '새 리서치'),
    createdAt: now,
    updatedAt: now,
    messages: [],
  }
  await updateState(config, (state) => {
    state.conversations[id] = conversation
    pruneConversations(state)
    return state
  })
  return publicConversation(conversation)
}

export async function listConversations(config) {
  const state = await readState(config)
  return Object.values(state.conversations)
    .map(publicConversation)
    .sort((left, right) => right.updatedAt - left.updatedAt)
}

export async function getConversation(config, id) {
  const state = await readState(config)
  const conversation = state.conversations[id]
  if (!conversation) {
    throw new LocalAgentError('대화를 찾을 수 없습니다.', 'conversation_not_found', 404)
  }
  return structuredClone(conversation)
}

export async function appendConversationMessages(config, id, messages, options = {}) {
  if (!Array.isArray(messages) || messages.length === 0) return getConversation(config, id)
  const now = options.now?.() ?? Date.now()
  let result
  await updateState(config, (state) => {
    const conversation = state.conversations[id]
    if (!conversation) {
      throw new LocalAgentError('대화를 찾을 수 없습니다.', 'conversation_not_found', 404)
    }
    const normalized = messages.map(normalizeMessage)
    conversation.messages.push(...normalized)
    conversation.messages = conversation.messages.slice(-MAX_CONVERSATION_MESSAGES)
    if (
      conversation.title === '새 리서치' &&
      normalized.find((message) => message.role === 'user')?.text
    ) {
      conversation.title = cleanTitle(
        normalized.find((message) => message.role === 'user').text,
      )
    }
    conversation.updatedAt = now
    result = structuredClone(conversation)
    return state
  })
  return result
}

export async function deleteConversation(config, id) {
  let existed = false
  await updateState(config, (state) => {
    existed = Boolean(state.conversations[id])
    delete state.conversations[id]
    return state
  })
  return { id, deleted: existed }
}

function normalizeMessage(message) {
  if (!message || !['user', 'assistant', 'tool'].includes(message.role)) {
    throw new LocalAgentError('지원하지 않는 대화 메시지입니다.', 'invalid_conversation')
  }
  const text = String(message.text || '').slice(0, MAX_MESSAGE_TEXT)
  const normalized = {
    id: typeof message.id === 'string' && message.id ? message.id : `message_${randomUUID()}`,
    role: message.role,
    text,
    createdAt: Number.isSafeInteger(message.createdAt) ? message.createdAt : Date.now(),
  }
  if (message.toolName) normalized.toolName = String(message.toolName).slice(0, 128)
  if (message.toolUseId) normalized.toolUseId = String(message.toolUseId).slice(0, 256)
  if (message.status) normalized.status = String(message.status).slice(0, 32)
  return normalized
}

function publicConversation(conversation) {
  return {
    id: conversation.id,
    title: conversation.title,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    messageCount: conversation.messages.length,
  }
}

function cleanTitle(value) {
  const title = String(value || '').replace(/\s+/g, ' ').trim()
  if (!title) return '새 리서치'
  return title.length > 42 ? `${title.slice(0, 41)}…` : title
}

function pruneConversations(state) {
  const ordered = Object.values(state.conversations).sort(
    (left, right) => right.updatedAt - left.updatedAt,
  )
  for (const conversation of ordered.slice(MAX_CONVERSATIONS)) {
    delete state.conversations[conversation.id]
  }
}
