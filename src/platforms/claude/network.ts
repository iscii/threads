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

interface PromptBody {
  prompt: string
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
    const prefix = `<context>\n${summaries.join('\n')}\n</context>\n\n`
    const uuids = {
      turn_message_uuids: {
        human_message_uuid: crypto.randomUUID(),
        assistant_message_uuid: crypto.randomUUID(),
      },
    }

    if (isMessagesBody(body)) {
      const msgs = [...body.messages]
      const lastUserIdx = msgs.map(m => m.role).lastIndexOf('user')
      if (lastUserIdx === -1) return null

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
        ...(body.turn_message_uuids ? uuids : {}),
      }
    }

    if (isPromptBody(body)) {
      return {
        ...body,
        prompt: prefix + body.prompt,
        ...(body.turn_message_uuids ? uuids : {}),
      }
    }

    return null
  },
}

function isMessagesBody(body: unknown): body is MessagesBody {
  return (
    typeof body === 'object' &&
    body !== null &&
    Array.isArray((body as MessagesBody).messages)
  )
}

function isPromptBody(body: unknown): body is PromptBody {
  return (
    typeof body === 'object' &&
    body !== null &&
    typeof (body as PromptBody).prompt === 'string'
  )
}
