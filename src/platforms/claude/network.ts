import type { EndpointShape, EndpointVars, NetworkAdapter } from '@/types'
import { THR_CONTEXT_TAG, THR_CONTEXT_STRIP_RE, THR_EXT_MARKER } from '@/messaging'
import { CLAUDE_MSG } from './messaging'

const HAIKU_MODEL = 'claude-haiku-4-5-20251001'
const COMPLETION_TEMPLATE =
  '/api/organizations/{organizationUuid}/chat_conversations/{conversationUuid}/completion'

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

export const claudeAdapter: NetworkAdapter = {
  urlPattern: /\/api\/organizations\/[^/]+\/chat_conversations\/[^/]+\/completion/,
  messages: {
    endpointCaptured: CLAUDE_MSG.ENDPOINT_CAPTURED,
    summaryInjected: CLAUDE_MSG.SUMMARY_INJECTED,
    streamComplete: CLAUDE_MSG.STREAM_COMPLETE,
  },

  isStreamDone(chunk: string): boolean {
    return chunk.includes('data: [DONE]')
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

  captureCompletion(url: string, body: unknown): EndpointShape | null {
    if (!isPromptBody(body) || !parseCompletionURL(url)) return null
    return {
      url: COMPLETION_TEMPLATE,
      body: sanitizePromptBody(body),
    }
  },

  captureEndpointVars(url: string, body: unknown): EndpointVars | null {
    const ids = parseCompletionURL(url) ?? parseConversationURL(url)
    if (!ids) return null

    const parentMessageUuid = isPromptBody(body)
      ? stringValue(body.parent_message_uuid)
      : latestMessageUuid(body)

    return {
      ...ids,
      ...(parentMessageUuid ? { parentMessageUuid } : {}),
    }
  },

  buildEndpoint(shape: EndpointShape, vars: EndpointVars): EndpointShape | null {
    if (!isPromptBody(shape.body)) return null
    return {
      url: shape.url
        .replace('{organizationUuid}', vars.organizationUuid)
        .replace('{conversationUuid}', vars.conversationUuid),
      body: {
        ...shape.body,
        model: HAIKU_MODEL,
        ...(vars.parentMessageUuid ? { parent_message_uuid: vars.parentMessageUuid } : {}),
      },
    }
  },

  history: {
    urlPattern: /\/api\/organizations\/[^/]+\/chat_conversations\/[^/?]+/,

    filter(body: unknown, lastKnownRealLeaf?: string | null): unknown {
      if (!isConversationBody(body)) return body

      // Collect UUIDs of tagged human messages
      const taggedHumanUUIDs = new Set<string>()
      for (const msg of body.chat_messages) {
        if (msg.sender === 'human') {
          const firstText = msg.content.find(b => b.type === 'text')?.text
          if (typeof firstText === 'string' && firstText.startsWith(THR_EXT_MARKER)) {
            const uuid = stringValue(msg.uuid)
            if (uuid) taggedHumanUUIDs.add(uuid)
          }
        }
      }

      // Collect UUIDs of their paired assistant responses
      const strippedUUIDs = new Set<string>(taggedHumanUUIDs)
      for (const msg of body.chat_messages) {
        if (msg.sender === 'assistant') {
          const parent = stringValue(msg.parent_message_uuid)
          if (parent && taggedHumanUUIDs.has(parent)) {
            const uuid = stringValue(msg.uuid)
            if (uuid) strippedUUIDs.add(uuid)
          }
        }
      }

      const chat_messages = body.chat_messages
        .filter(msg => {
          const uuid = stringValue(msg.uuid)
          return !uuid || !strippedUUIDs.has(uuid)
        })
        .map(msg => {
          if (msg.sender !== 'human') return msg
          return {
            ...msg,
            content: msg.content.map(block =>
              block.type === 'text'
                ? { ...block, text: block.text.replace(THR_CONTEXT_STRIP_RE, '') }
                : block
            ),
          }
        })

      const currentLeaf = stringValue(body.current_leaf_message_uuid)
      const fixedLeaf =
        currentLeaf && strippedUUIDs.has(currentLeaf) && lastKnownRealLeaf
          ? lastKnownRealLeaf
          : currentLeaf

      return {
        ...body,
        chat_messages,
        ...(fixedLeaf !== undefined ? { current_leaf_message_uuid: fixedLeaf } : {}),
      }
    },
  },
}

function sanitizePromptBody(body: PromptBody): PromptBody {
  const sanitized: PromptBody = {
    prompt: '',
    attachments: arrayValue(body.attachments),
    files: arrayValue(body.files),
    locale: stringValue(body.locale) ?? 'en-US',
    model: HAIKU_MODEL,
    personalized_styles: arrayValue(body.personalized_styles),
    rendering_mode: stringValue(body.rendering_mode) ?? 'messages',
    sync_sources: arrayValue(body.sync_sources),
    tools: arrayValue(body.tools),
  }
  const timezone = stringValue(body.timezone)
  if (timezone) sanitized.timezone = timezone
  return sanitized
}

function parseCompletionURL(url: string): EndpointVars | null {
  const path = pathFromURL(url)
  const match = path.match(
    /^\/api\/organizations\/([^/]+)\/chat_conversations\/([^/]+)\/completion$/,
  )
  if (!match) return null
  return { organizationUuid: match[1], conversationUuid: match[2] }
}

function parseConversationURL(url: string): EndpointVars | null {
  const path = pathFromURL(url)
  const match = path.match(
    /^\/api\/organizations\/([^/]+)\/chat_conversations\/([^/?]+)$/,
  )
  if (!match) return null
  return { organizationUuid: match[1], conversationUuid: match[2] }
}

function pathFromURL(url: string): string {
  try {
    return new URL(url, location.href).pathname
  } catch {
    return url.split('?')[0]
  }
}

function latestMessageUuid(body: unknown): string | undefined {
  if (!isConversationBody(body)) return stringValue((body as { current_leaf_message_uuid?: unknown })?.current_leaf_message_uuid)
  for (let i = body.chat_messages.length - 1; i >= 0; i -= 1) {
    const uuid = messageUuid(body.chat_messages[i])
    if (uuid) return uuid
  }
  return undefined
}

function messageUuid(msg: ChatMessage): string | undefined {
  return stringValue(msg.uuid) ?? stringValue(msg.message_uuid) ?? stringValue(msg.id)
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
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
