export const convId = (): string =>
  location.pathname.split('/chat/')[1]?.split('/')[0] ?? ''

export const threadKey = (blockId: string): string =>
  `thr:${convId()}:${blockId}`

export const summaryKey = (): string =>
  `sum:${convId()}`
