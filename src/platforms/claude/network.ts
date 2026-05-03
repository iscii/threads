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
