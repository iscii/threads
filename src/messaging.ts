export const MSG = {
  STAGE_SUMMARY: 'THR_STAGE_SUMMARY',
} as const

export const THR_CONTEXT_TAG = 'threads-context'
export const THR_INTERNAL_TAG = 'threads-internal'
export const THR_CONTEXT_STRIP_RE = new RegExp(
  `^<${THR_CONTEXT_TAG}>\\n[\\s\\S]*?\\n<\\/${THR_CONTEXT_TAG}>\\n\\n`,
)
export const THR_CONTEXT_ESCAPED_STRIP_RE = new RegExp(
  `<${THR_CONTEXT_TAG}>\\\\n[\\s\\S]*?\\\\n<\\/${THR_CONTEXT_TAG}>\\\\n\\\\n`,
)
export const THR_INTERNAL_STRIP_RE = new RegExp(
  `^<${THR_INTERNAL_TAG}[^>]*>\\n[\\s\\S]*?\\n<\\/${THR_INTERNAL_TAG}>\\n\\n`,
)

export interface StageSummaryMsg {
  type: typeof MSG.STAGE_SUMMARY
  summaryTexts: string[]
}
