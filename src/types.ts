export interface NetworkAdapter {
  urlPattern: RegExp
  messages: {
    endpointCaptured: string
    summaryInjected: string
    streamComplete: string
  }
  inject(body: unknown, summaries: string[]): { body: unknown; injected: boolean }
  buildCompletion(capturedBody: unknown, prompt: string, model?: string): unknown
  isStreamDone?(chunk: string): boolean
  history?: {
    urlPattern: RegExp
    filter(body: unknown): unknown
  }
}

export interface DOMAdapter {
  /** Returns the element the per-conversation MutationObserver targets. */
  findScrollContainer(): Element | null

  /** Returns all assistant turn containers within root. */
  findAssistantTurns(root: Element): Element[]

  /** Returns true when a turn has finished streaming and final blocks are in the DOM. */
  isStreamingComplete(turn: Element): boolean

  /** Returns block-level elements within a completed turn. */
  findBlocks(turn: Element): Element[]

  /** Returns the main chat input element. */
  findInput(): Element | null

  /** Returns the page header element. */
  findHeader(): Element | null
}

export interface Platform {
  domAdapter: DOMAdapter
  networkAdapter: NetworkAdapter
  theme: string
}
