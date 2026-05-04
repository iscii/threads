export const convId = (): string =>
  location.pathname.split('/chat/')[1]?.split('/')[0] ?? ''

export const threadKey = (blockId: string): string =>
  `thr:${convId()}:${blockId}`

export const summaryKey = (): string =>
  `sum:${convId()}`

export const endpointShapeKey = (): string =>
  `end:${location.hostname}:shape`

export const endpointVarsKey = (): string =>
  `end:${location.hostname}:${convId()}:vars`
