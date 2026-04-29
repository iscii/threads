export const MSG = {
  STAGE_SUMMARY: 'THR_STAGE_SUMMARY',
} as const

export const THR_CONTEXT_TAG = 'threads-context'

export interface StageSummaryMsg {
  type: typeof MSG.STAGE_SUMMARY
  summaryTexts: string[]
}
