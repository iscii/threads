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

export const claudeAdapter: NetworkAdapter = {
  urlPattern: /\/api\/organizations\/[^/]+\/chat_conversations\/[^/]+\/completion/,
  messages: {
    endpointCaptured: CLAUDE_MSG.ENDPOINT_CAPTURED,
    summaryInjected: CLAUDE_MSG.SUMMARY_INJECTED,
    streamComplete: CLAUDE_MSG.STREAM_COMPLETE,
  },

  inject(body: unknown, summaries: string[]): unknown | null {
    if (!isPromptBody(body)) return null

    const prefix = `<context>\n${summaries.join('\n')}\n</context>\n\n`
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
}

function isPromptBody(body: unknown): body is PromptBody {
  return (
    typeof body === 'object' &&
    body !== null &&
    typeof (body as PromptBody).prompt === 'string'
  )
}
