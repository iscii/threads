export const CLAUDE_MSG = {
  ENDPOINT_CAPTURED: 'CLAUDE_ENDPOINT_CAPTURED',
  SUMMARY_INJECTED: 'CLAUDE_SUMMARY_INJECTED',
  STREAM_COMPLETE: 'CLAUDE_STREAM_COMPLETE',
} as const

export interface ClaudeEndpointCapturedMsg {
  type: typeof CLAUDE_MSG.ENDPOINT_CAPTURED
  url: string
  body: unknown
}

export interface ClaudeSummaryInjectedMsg {
  type: typeof CLAUDE_MSG.SUMMARY_INJECTED
}

export interface ClaudeStreamCompleteMsg {
  type: typeof CLAUDE_MSG.STREAM_COMPLETE
}

export type ClaudeOutboundMsg =
  | ClaudeEndpointCapturedMsg
  | ClaudeSummaryInjectedMsg
  | ClaudeStreamCompleteMsg
