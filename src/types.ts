export interface NetworkAdapter {
  urlPattern: RegExp
  inject(body: unknown, summaries: string[]): unknown | null
  isStreamDone?(chunk: string): boolean
}
