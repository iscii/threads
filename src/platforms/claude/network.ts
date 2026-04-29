import type { NetworkAdapter } from '@/types'
import { CLAUDE_MSG } from './messaging'

interface Message {
  role: string
  content: string | ContentBlock[]
  [key: string]: unknown
}

interface ContentBlock {
  type: string
  [key: string]: unknown
}

interface MessagesBody {
  messages: Message[]
  turn_message_uuids?: {
    human_message_uuid: string
    assistant_message_uuid: string
  }
  [key: string]: unknown
}

export const claudeAdapter: NetworkAdapter = {
  urlPattern: /\/api\/organizations\/[^/]+\/chat_conversations\/[^/]+\/completion/,
  messages: {
    endpointCaptured: CLAUDE_MSG.ENDPOINT_CAPTURED,
    summaryInjected: CLAUDE_MSG.SUMMARY_INJECTED,
    streamComplete: CLAUDE_MSG.STREAM_COMPLETE,
  },

  inject(body: unknown, summaries: string[]): unknown | null {
    if (!isMessagesBody(body)) return null

    const msgs = [...body.messages]
    const lastUserIdx = msgs.map(m => m.role).lastIndexOf('user')
    if (lastUserIdx === -1) return null

    const prefix = `<context>\n${summaries.join('\n')}\n</context>\n\n`
    const orig = msgs[lastUserIdx].content

    msgs[lastUserIdx] = {
      ...msgs[lastUserIdx],
      content: Array.isArray(orig)
        ? [{ type: 'text', text: prefix }, ...orig]
        : prefix + orig,
    }

    return {
      ...body,
      messages: msgs,
      ...(body.turn_message_uuids ? {
        turn_message_uuids: {
          human_message_uuid: crypto.randomUUID(),
          assistant_message_uuid: crypto.randomUUID(),
        },
      } : {}),
    }
  },
}

function isMessagesBody(body: unknown): body is MessagesBody {
  return (
    typeof body === 'object' &&
    body !== null &&
    Array.isArray((body as MessagesBody).messages)
  )
}
