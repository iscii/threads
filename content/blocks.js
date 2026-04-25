/**
 * blocks.js
 *
 * Given a completed assistant message container, finds addressable blocks,
 * stamps each with a unique ID, and attaches the hover icon that triggers
 * the inline reply popover.
 */

import { open as openPopover, close as closePopover } from "./popover.js";

// Block-level elements worth replying to individually.
// Excludes <br>, inline elements, and the ProseMirror trailing break.
const BLOCK_SELECTORS = ["p", "pre", "li", "h1", "h2", "h3", "h4", "blockquote"].join(",");

let blockCounter = 0;

/**
 * Extracts a short excerpt from a block for display in the popover header
 * and for inclusion in the injected message.
 * @param {Element} block
 * @returns {string}
 */
export function excerptFrom(block) {
  const text = block.innerText?.trim() ?? "";
  if (text.length <= 120) return text;
  return text.slice(0, 120).trimEnd() + "…";
}

/**
 * Creates the small comment icon button that appears on block hover.
 * @returns {Element}
 */
function makeIcon() {
  const btn = document.createElement("button");
  btn.className = "cir-icon";
  btn.setAttribute("aria-label", "Reply to this block");
  btn.title = "Reply to this block";
  btn.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
    </svg>
  `;
  return btn;
}

/**
 * Wraps a block element in a positioned container so we can absolutely
 * position the icon relative to it without disrupting layout.
 * @param {Element} block
 * @returns {Element} The wrapper
 */
function wrapBlock(block) {
  const wrapper = document.createElement("div");
  wrapper.className = "cir-block-wrapper";
  block.parentNode.insertBefore(wrapper, block);
  wrapper.appendChild(block);
  return wrapper;
}

/**
 * Attaches hover icon and click handler to a single block.
 * @param {Element} block
 */
function attachToBlock(block) {
  // Skip empty blocks (ProseMirror trailing breaks, etc.)
  if (!block.innerText?.trim()) return;

  const id = `cir-block-${++blockCounter}`;
  block.dataset.cirId = id;

  const wrapper = wrapBlock(block);
  const icon = makeIcon();
  wrapper.appendChild(icon);

  icon.addEventListener("click", (e) => {
    e.stopPropagation();
    openPopover(block, wrapper);
  });
}

/**
 * Entry point called by observer.js for each completed message.
 * @param {Element} messageContainer
 */
export function attachBlocks(messageContainer) {
  const blocks = messageContainer.querySelectorAll(BLOCK_SELECTORS);
  blocks.forEach(attachToBlock);
}
