export interface EndpointShape {
  url: string
  body: unknown
}

export interface EndpointVars {
  organizationUuid: string
  conversationUuid: string
  parentMessageUuid?: string
}

export interface NetworkAdapter {
  urlPattern: RegExp
  messages: {
    endpointCaptured: string
    summaryInjected: string
    streamComplete: string
  }
  inject(body: unknown, summaries: string[]): { body: unknown; injected: boolean }
  buildCompletion(capturedBody: unknown, prompt: string, model?: string): unknown
  captureCompletion?(url: string, body: unknown): EndpointShape | null
  captureEndpointVars?(url: string, body: unknown): EndpointVars | null
  buildEndpoint?(shape: EndpointShape, vars: EndpointVars): EndpointShape | null
  isStreamDone?(chunk: string): boolean
  history?: {
    urlPattern: RegExp
    filter(body: unknown, lastKnownRealLeaf?: string | null): unknown
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

  /** Returns the response content column (used to anchor the thread zone to its right edge). */
  findChatContainer(): Element | null

  /** Returns the header action bar where the badge should be prepended (before Share). */
  findHeaderActions(): Element | null
}

export interface Platform {
  domAdapter: DOMAdapter
  networkAdapter: NetworkAdapter
  theme: string
}
