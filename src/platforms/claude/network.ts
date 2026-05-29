import type { NetworkAdapter } from '@/types'
import { THR_CONTEXT_TAG, THR_CONTEXT_STRIP_RE } from '@/messaging'
import { CLAUDE_MSG } from './messaging'

interface PromptBody {
  prompt: string
  turn_message_uuids?: {
    human_message_uuid: string
    assistant_message_uuid: string
  }
  [key: string]: unknown
}

interface ContentBlock {
  type: string
  text: string
  [key: string]: unknown
}

interface ChatMessage {
  sender: string
  content: ContentBlock[]
  [key: string]: unknown
}

interface ConversationBody {
  chat_messages: ChatMessage[]
  [key: string]: unknown
}

type RuntimeValue = string | number | boolean | null

const rotatingRuntimeValues = new Map<string, RuntimeValue>()
const ROTATING_KEY_RE = /(^|_)(access_)?token$|(^|_)(csrf|nonce|session|signature|request_id|client_request_id)(_|$)/i

export const claudeAdapter: NetworkAdapter = {
  urlPattern: /\/api\/organizations\/[^/]+\/chat_conversations\/[^/]+\/completion/,
  messages: {
    endpointCaptured: CLAUDE_MSG.ENDPOINT_CAPTURED,
    summaryInjected: CLAUDE_MSG.SUMMARY_INJECTED,
    streamComplete: CLAUDE_MSG.STREAM_COMPLETE,
    runtimeValues: CLAUDE_MSG.RUNTIME_VALUES,
  },

  inject(body: unknown, summaries: string[]): { body: unknown; injected: boolean } {
    if (!isPromptBody(body)) return { body, injected: false }

    const prefix = `<${THR_CONTEXT_TAG}>\n${summaries.join('\n')}\n</${THR_CONTEXT_TAG}>\n\n`
    return {
      body: {
        ...body,
        prompt: prefix + body.prompt,
        ...(body.turn_message_uuids ? {
          turn_message_uuids: {
            human_message_uuid: crypto.randomUUID(),
            assistant_message_uuid: crypto.randomUUID(),
          },
        } : {}),
      },
      injected: true,
    }
  },

  buildCompletion(capturedBody: unknown, prompt: string, model?: string): unknown {
    if (!isPromptBody(capturedBody)) return capturedBody
    return {
      ...capturedBody,
      prompt,
      ...(model ? { model } : {}),
      turn_message_uuids: {
        human_message_uuid: crypto.randomUUID(),
        assistant_message_uuid: crypto.randomUUID(),
      },
    }
  },

  observeRuntimeValues(_url: string, body: unknown): void {
    collectRotatingValues(body)
  },

  refreshCapturedBody(body: unknown): unknown {
    return replaceRotatingValues(body)
  },

  history: {
    urlPattern: /\/api\/organizations\/[^/]+\/chat_conversations\/[^/?]+/,

    filter(body: unknown): unknown {
      if (!isConversationBody(body)) return body
      return {
        ...body,
        chat_messages: body.chat_messages.map(msg => {
          if (msg.sender !== 'human') return msg
          return {
            ...msg,
            content: msg.content.map(block =>
              block.type === 'text'
                ? { ...block, text: block.text.replace(THR_CONTEXT_STRIP_RE, '') }
                : block
            ),
          }
        }),
      }
    },
  },
}

function isRuntimeValue(value: unknown): value is RuntimeValue {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  )
}

function collectRotatingValues(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) collectRotatingValues(item)
    return
  }
  if (typeof value !== 'object' || value === null) return

  for (const [key, child] of Object.entries(value)) {
    if (ROTATING_KEY_RE.test(key) && isRuntimeValue(child)) {
      rotatingRuntimeValues.set(key, child)
    }
    collectRotatingValues(child)
  }
}

function replaceRotatingValues(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(item => replaceRotatingValues(item))
  if (typeof value !== 'object' || value === null) return value

  let changed = false
  const next: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    if (ROTATING_KEY_RE.test(key) && rotatingRuntimeValues.has(key) && isRuntimeValue(child)) {
      next[key] = rotatingRuntimeValues.get(key)
      changed = changed || next[key] !== child
    } else {
      const replaced = replaceRotatingValues(child)
      next[key] = replaced
      changed = changed || replaced !== child
    }
  }
  return changed ? next : value
}

function isPromptBody(body: unknown): body is PromptBody {
  return (
    typeof body === 'object' &&
    body !== null &&
    typeof (body as PromptBody).prompt === 'string'
  )
}

function isConversationBody(body: unknown): body is ConversationBody {
  return (
    typeof body === 'object' &&
    body !== null &&
    Array.isArray((body as ConversationBody).chat_messages)
  )
}
