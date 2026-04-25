// =============================================================
// Claude Inline Reply — content.js
// Single-file content script (no ES module imports needed).
// =============================================================

// -------------------------
// INJECTOR
// -------------------------

function findInput() {
  return document.querySelector('div[data-testid="chat-input"]');
}

function findSendButton() {
  return document.querySelector('button[aria-label="Send message"]');
}

function injectIntoContentEditable(el, text) {
  el.click();
  el.focus();
  document.execCommand("selectAll", false, null);
  const inserted = document.execCommand("insertText", false, text);
  if (!inserted) {
    el.innerText = text;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    const range = document.createRange();
    const sel = window.getSelection();
    range.selectNodeContents(el);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  }
}

function injectAndSend(text) {
  const input = findInput();
  if (!input) {
    console.warn("[CIR] Could not find chat input.");
    return false;
  }
  injectIntoContentEditable(input, text);
  setTimeout(() => {
    const btn = findSendButton();
    if (!btn || btn.disabled) {
      console.warn("[CIR] Send button not ready.");
      return;
    }
    btn.click();
  }, 50);
  return true;
}

// -------------------------
// POPOVER
// -------------------------

let popoverEl = null;
let activeWrapper = null;

function excerptFrom(block) {
  const text = block.innerText?.trim() ?? "";
  if (text.length <= 120) return text;
  return text.slice(0, 120).trimEnd() + "…";
}

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

  popoverEl.querySelector(".cir-popover-send").addEventListener("click", submitPopover);
  popoverEl.querySelector(".cir-popover-input").addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); submitPopover(); }
    if (e.key === "Escape") closePopover();
  });
  document.addEventListener("click", (e) => {
    if (popoverEl && !popoverEl.contains(e.target) && !e.target.closest(".cir-icon")) {
      closePopover();
    }
  });

  return popoverEl;
}

function submitPopover() {
  const textarea = popoverEl.querySelector(".cir-popover-input");
  const userText = textarea.value.trim();
  if (!userText) return;
  const excerpt = popoverEl.querySelector(".cir-popover-excerpt").dataset.fullExcerpt;
  const message = `Regarding your point: "${excerpt}"\n\n${userText}`;
  if (injectAndSend(message)) closePopover();
}

function openPopover(block, wrapper) {
  if (activeWrapper === wrapper) { closePopover(); return; }
  if (activeWrapper) activeWrapper.classList.remove("cir-block-active");
  activeWrapper = wrapper;
  wrapper.classList.add("cir-block-active");

  const popover = getOrCreatePopover();
  const excerpt = excerptFrom(block);
  const excerptEl = popover.querySelector(".cir-popover-excerpt");
  excerptEl.textContent = `"${excerpt}"`;
  excerptEl.dataset.fullExcerpt = excerpt;
  popover.querySelector(".cir-popover-input").value = "";

  const rect = wrapper.getBoundingClientRect();
  popover.style.top = `${rect.bottom + window.scrollY + 6}px`;
  popover.style.left = `${rect.left + window.scrollX}px`;
  popover.style.width = `${Math.min(rect.width, 640)}px`;
  popover.classList.add("cir-popover-visible");

  requestAnimationFrame(() => popover.querySelector(".cir-popover-input").focus());
}

function closePopover() {
  if (!popoverEl) return;
  popoverEl.classList.remove("cir-popover-visible");
  if (activeWrapper) { activeWrapper.classList.remove("cir-block-active"); activeWrapper = null; }
  const textarea = popoverEl?.querySelector(".cir-popover-input");
  if (textarea) textarea.value = "";
}

// -------------------------
// BLOCKS
// -------------------------

const BLOCK_SELECTORS = ["p", "pre", "li", "h1", "h2", "h3", "h4", "blockquote"].join(",");
let blockCounter = 0;

function makeCollapseToggle(block, wrapper) {
  const toggle = document.createElement("button");
  toggle.className = "cir-collapse-toggle";
  toggle.textContent = "▼ Hide code";

  // Insert above the block inside the wrapper
  wrapper.insertBefore(toggle, block);

  // Start collapsed state tracking
  let collapsed = false;

  toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    collapsed = !collapsed;
    block.style.maxHeight = collapsed ? "0" : "";
    block.style.overflow = collapsed ? "hidden" : "";
    block.style.marginTop = collapsed ? "0" : "";
    toggle.textContent = collapsed ? "▶ Show code" : "▼ Hide code";
    wrapper.classList.toggle("cir-code-collapsed", collapsed);
  });
}

function makeIcon() {
  const btn = document.createElement("button");
  btn.className = "cir-icon";
  btn.setAttribute("aria-label", "Reply to this block");
  btn.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
    </svg>
  `;
  return btn;
}

function attachToBlock(block) {
  if (!block.innerText?.trim()) return;

  const id = `cir-block-${++blockCounter}`;
  block.dataset.cirId = id;

  const wrapper = document.createElement("div");
  wrapper.className = "cir-block-wrapper";
  block.parentNode.insertBefore(wrapper, block);
  wrapper.appendChild(block);

  const icon = makeIcon();
  wrapper.appendChild(icon);
  icon.addEventListener("click", (e) => {
    e.stopPropagation();
    openPopover(block, wrapper);
  });

  // Code blocks get an extra collapse toggle
  if (block.tagName === "PRE") {
    makeCollapseToggle(block, wrapper);
  }
}

function attachBlocks(messageContainer) {
  const blocks = messageContainer.querySelectorAll(BLOCK_SELECTORS);
  blocks.forEach(attachToBlock);
}

// -------------------------
// OBSERVER
// -------------------------

const MESSAGE_CONTAINER = "div.font-claude-response";
const STABILITY_DELAY = 800;
const pendingTimers = new Map();

function scheduleProcess(msgEl) {
  if (pendingTimers.has(msgEl)) clearTimeout(pendingTimers.get(msgEl));

  const timer = setTimeout(() => {
    pendingTimers.delete(msgEl);
    if (!msgEl.dataset.cirProcessed) {
      msgEl.dataset.cirProcessed = "true";
      attachBlocks(msgEl);
    }
  }, STABILITY_DELAY);

  pendingTimers.set(msgEl, timer);
}

function findMessageContainer(node) {
  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  if (node.matches(MESSAGE_CONTAINER)) return node;
  return node.closest(MESSAGE_CONTAINER);
}

const observer = new MutationObserver((mutations) => {
  const seen = new Set();
  for (const mutation of mutations) {
    for (const node of [mutation.target, ...mutation.addedNodes]) {
      const msgEl = findMessageContainer(node);
      if (msgEl && !msgEl.dataset.cirProcessed && !seen.has(msgEl)) {
        seen.add(msgEl);
        scheduleProcess(msgEl);
      }
    }
  }
});

observer.observe(document.body, { childList: true, subtree: true, characterData: true });