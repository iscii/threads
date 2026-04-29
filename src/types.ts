export interface NetworkAdapter {
  urlPattern: RegExp
  messages: {
    endpointCaptured: string
    summaryInjected: string
    streamComplete: string
  }
  inject(body: unknown, summaries: string[]): unknown | null
  isStreamDone?(chunk: string): boolean
  historyUrlPattern?: RegExp
  filterHistory?(body: unknown): unknown
}
