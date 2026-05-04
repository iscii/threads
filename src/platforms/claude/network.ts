import type { EndpointShape, EndpointVars, NetworkAdapter } from '@/types'
import {
  THR_CONTEXT_ESCAPED_STRIP_RE,
  THR_CONTEXT_TAG,
  THR_CONTEXT_STRIP_RE,
  THR_INTERNAL_STRIP_RE,
} from '@/messaging'
import { CLAUDE_MSG } from './messaging'

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

  filterResponseText(chunk: string): string {
    return stripInjectedContext(chunk)
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
        ...(vars.parentMessageUuid ? { parent_message_uuid: vars.parentMessageUuid } : {}),
      },
    }
  },

  history: {
    urlPattern: /\/api\/organizations\/[^/]+\/chat_conversations\/[^/?]+(?:\?|$)/,

    filter(body: unknown): unknown {
      if (!isConversationBody(body)) return body
      const chatMessages: ChatMessage[] = []
      const internalHumanIds = new Set<string>()

      for (const msg of body.chat_messages) {
        if (msg.sender !== 'human' || !isInternalMessage(msg)) continue
        const uuid = messageUuid(msg)
        if (uuid) internalHumanIds.add(uuid)
      }

      for (const msg of body.chat_messages) {
        if (msg.sender === 'assistant' && shouldRemoveInternalAssistant(msg, internalHumanIds)) {
          continue
        }

        if (msg.sender === 'human' && isInternalMessage(msg)) {
          continue
        }

        chatMessages.push(stripHumanContext(msg))
      }

      return {
        ...body,
        chat_messages: chatMessages,
      }
    },
  },
}

export function stripInjectedContext(text: string): string {
  return text
    .replace(THR_CONTEXT_STRIP_RE, '')
    .replace(THR_CONTEXT_ESCAPED_STRIP_RE, '')
}

function stripHumanContext(msg: ChatMessage): ChatMessage {
  if (msg.sender !== 'human') return msg
  return {
    ...msg,
    content: msg.content.map(block =>
      block.type === 'text'
        ? { ...block, text: stripInjectedContext(block.text) }
        : block
    ),
  }
}

function isInternalMessage(msg: ChatMessage): boolean {
  return msg.content.some(block =>
    block.type === 'text' &&
    (
      THR_INTERNAL_STRIP_RE.test(block.text) ||
      block.text.startsWith('You are a deterministic text summarization function.')
    )
  )
}

function shouldRemoveInternalAssistant(
  msg: ChatMessage,
  internalHumanIds: Set<string>,
): boolean {
  if (internalHumanIds.size === 0) return false
  const parentUuid = parentMessageUuid(msg)
  return !!parentUuid && internalHumanIds.has(parentUuid)
}

function sanitizePromptBody(body: PromptBody): PromptBody {
  const sanitized: PromptBody = {
    prompt: '',
    attachments: arrayValue(body.attachments),
    files: arrayValue(body.files),
    locale: stringValue(body.locale) ?? 'en-US',
    personalized_styles: arrayValue(body.personalized_styles),
    rendering_mode: stringValue(body.rendering_mode) ?? 'messages',
    sync_sources: arrayValue(body.sync_sources),
    tools: arrayValue(body.tools),
  }
  const model = stringValue(body.model)
  if (model) sanitized.model = model
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

function parentMessageUuid(msg: ChatMessage): string | undefined {
  const parentMessage = objectValue(msg.parent_message)
  return (
    stringValue(msg.parent_message_uuid) ??
    stringValue(parentMessage?.uuid) ??
    stringValue(parentMessage?.message_uuid) ??
    stringValue(parentMessage?.id)
  )
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? value as Record<string, unknown>
    : undefined
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
