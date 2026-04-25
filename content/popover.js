/**
 * popover.js
 *
 * Singleton popover. One exists in the DOM, repositions to whichever block
 * was clicked. Owns the quoted excerpt display, textarea, send button,
 * keyboard shortcuts, and teardown.
 */

import { injectAndSend } from "./injector.js";
import { excerptFrom } from "./blocks.js";

let popoverEl = null;
let activeWrapper = null;

/**
 * Builds the popover element once and caches it.
 * @returns {Element}
 */
function getOrCreatePopover() {
  if (popoverEl) return popoverEl;

  popoverEl = document.createElement("div");
  popoverEl.className = "cir-popover";
  popoverEl.innerHTML = `
    <div class="cir-popover-excerpt"></div>
    <textarea class="cir-popover-input" placeholder="Reply to this block…" rows="3"></textarea>
    <div class="cir-popover-footer">
      <span class="cir-popover-hint">⌘↵ to send</span>
      <button class="cir-popover-send">Send</button>
    </div>
  `;

  document.body.appendChild(popoverEl);

  // Send button click
  popoverEl.querySelector(".cir-popover-send").addEventListener("click", () => {
    submit();
  });

  // Keyboard shortcuts
  popoverEl.querySelector(".cir-popover-input").addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      submit();
    }
    if (e.key === "Escape") {
      close();
    }
  });

  // Click outside to close
  document.addEventListener("click", onOutsideClick);

  return popoverEl;
}

function onOutsideClick(e) {
  if (popoverEl && !popoverEl.contains(e.target) && !e.target.closest(".cir-icon")) {
    close();
  }
}

/**
 * Constructs the quoted message and fires it into the chat input.
 */
function submit() {
  const textarea = popoverEl.querySelector(".cir-popover-input");
  const userText = textarea.value.trim();
  if (!userText) return;

  const excerpt = popoverEl.querySelector(".cir-popover-excerpt").dataset.fullExcerpt;
  const message = `Regarding your point: "${excerpt}"\n\n${userText}`;

  const ok = injectAndSend(message);
  if (ok) close();
}

/**
 * Opens the popover anchored below the given block wrapper.
 * @param {Element} block - The content block being replied to
 * @param {Element} wrapper - The .cir-block-wrapper around it
 */
export function open(block, wrapper) {
  // If clicking the same block, toggle close
  if (activeWrapper === wrapper) {
    close();
    return;
  }

  // Remove highlight from previous
  if (activeWrapper) activeWrapper.classList.remove("cir-block-active");

  activeWrapper = wrapper;
  wrapper.classList.add("cir-block-active");

  const popover = getOrCreatePopover();

  // Set excerpt
  const excerpt = excerptFrom(block);
  const excerptEl = popover.querySelector(".cir-popover-excerpt");
  excerptEl.textContent = `"${excerpt}"`;
  excerptEl.dataset.fullExcerpt = excerpt;

  // Clear previous input
  popover.querySelector(".cir-popover-input").value = "";

  // Position below the wrapper
  const rect = wrapper.getBoundingClientRect();
  popover.style.top = `${rect.bottom + window.scrollY + 6}px`;
  popover.style.left = `${rect.left + window.scrollX}px`;
  popover.style.width = `${Math.min(rect.width, 640)}px`;
  popover.classList.add("cir-popover-visible");

  // Focus textarea
  requestAnimationFrame(() => {
    popover.querySelector(".cir-popover-input").focus();
  });
}

/**
 * Closes the popover and cleans up active state.
 */
export function close() {
  if (!popoverEl) return;
  popoverEl.classList.remove("cir-popover-visible");

  if (activeWrapper) {
    activeWrapper.classList.remove("cir-block-active");
    activeWrapper = null;
  }

  const textarea = popoverEl.querySelector(".cir-popover-input");
  if (textarea) textarea.value = "";
}
