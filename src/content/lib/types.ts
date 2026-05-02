export interface BlockDescriptor {
  /** Stable ID derived from block text content via MurmurHash3. */
  id: string
  /** The block's DOM element (p.font-claude-response-body on Claude). */
  element: HTMLElement
  /** Text content, truncated to 130 chars + ellipsis if longer. */
  text: string
}

export interface DOMLayerCallbacks {
  /** Fired once per completed assistant turn with all its blocks. */
  onBlocksFound(blocks: BlockDescriptor[]): void
  /** Fired when user clicks the trigger button on a block. */
  onBlockTriggerClicked(blockId: string): void
  /** Fired when SPA navigation changes the active conversation. */
  onConversationChanged(): void
}

export interface DOMLayerAPI {
  /** Wraps block elements, injects trigger buttons, shows zone. Called by coordinator on onBlocksFound. */
  instrumentBlocks(blocks: BlockDescriptor[]): void
  /** Returns the shadow root of the thread zone host for Preact rendering. */
  getShadowRoot(): ShadowRoot
  /** Sets data-thr-state on the block wrapper for the styling layer to read. */
  setBlockState(blockId: string, state: 'idle' | 'has-thread' | 'active'): void
  /** Returns the viewport-relative top of the block wrapper. */
  getBlockTop(blockId: string): number
  /** Returns the pixel height of the thread zone (viewport height minus header). */
  getZoneHeight(): number
  /** Disconnects the ResizeObserver and removes the host from the DOM. Call on conversation change. */
  destroy(): void
}
