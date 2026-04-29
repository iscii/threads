import type { NetworkAdapter } from '@/types'
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

const CTX_TAG = 'threads-context'
const CTX_STRIP_RE = new RegExp(`^<${CTX_TAG}>\\n[\\s\\S]*?\\n<\\/${CTX_TAG}>\\n\\n`)

export const claudeAdapter: NetworkAdapter = {
  urlPattern: /\/api\/organizations\/[^/]+\/chat_conversations\/[^/]+\/completion/,
  historyUrlPattern: /\/api\/organizations\/[^/]+\/chat_conversations\/[^/?]+/,
  messages: {
    endpointCaptured: CLAUDE_MSG.ENDPOINT_CAPTURED,
    summaryInjected: CLAUDE_MSG.SUMMARY_INJECTED,
    streamComplete: CLAUDE_MSG.STREAM_COMPLETE,
  },

  inject(body: unknown, summaries: string[]): unknown | null {
    if (!isPromptBody(body)) return null

    const prefix = `<${CTX_TAG}>\n${summaries.join('\n')}\n</${CTX_TAG}>\n\n`
    return {
      ...body,
      prompt: prefix + body.prompt,
      ...(body.turn_message_uuids ? {
        turn_message_uuids: {
          human_message_uuid: crypto.randomUUID(),
          assistant_message_uuid: crypto.randomUUID(),
        },
      } : {}),
    }
  },

  filterHistory(body: unknown): unknown {
    if (!isConversationBody(body)) return body
    return {
      ...body,
      chat_messages: body.chat_messages.map(msg => {
        if (msg.sender !== 'human') return msg
        return {
          ...msg,
          content: msg.content.map(block =>
            block.type === 'text'
              ? { ...block, text: block.text.replace(CTX_STRIP_RE, '') }
              : block
          ),
        }
      }),
    }
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
