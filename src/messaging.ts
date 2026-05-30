export const MSG = {
  STAGE_SUMMARY: 'THR_STAGE_SUMMARY',
} as const

export const THR_CONTEXT_TAG = 'recall'
export const THR_CONTEXT_STRIP_RE = new RegExp(
  `^<${THR_CONTEXT_TAG}>\\n[\\s\\S]*?\\n<\\/${THR_CONTEXT_TAG}>\\n\\n`,
)

export const THR_EXT_MARKER = '<x/>'

export interface StageSummaryMsg {
  type: typeof MSG.STAGE_SUMMARY
  summaryTexts: string[]
}
