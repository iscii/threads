export interface NetworkAdapter {
  urlPattern: RegExp
  messages: {
    endpointCaptured: string
    summaryInjected: string
    streamComplete: string
  }
  inject(body: unknown, summaries: string[]): { body: unknown; injected: boolean }
  isStreamDone?(chunk: string): boolean
  history?: {
    urlPattern: RegExp
    filter(body: unknown): unknown
  }
}
