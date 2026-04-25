/**
 * injector.js
 *
 * Single responsibility: take a string, put it in claude.ai's input, send it.
 *
 * Claude.ai uses a React-controlled contenteditable div for its input.
 * Simply setting .innerText won't trigger React's synthetic event system,
 * so the send button stays disabled. We use document.execCommand('insertText')
 * which dispatches real DOM input events that React's reconciler picks up.
 *
 * If Anthropic ever switches to a <textarea>, the textarea path below handles it.
 */

const SELECTORS = {
  // The contenteditable input div. Identified by role, not class names.
  input: 'div[data-testid="chat-input"]',

  // Fallback if they ever switch to a plain textarea
  inputFallback: 'textarea[data-testid="chat-input"]',

  // Send button — closest button sibling to the input that isn't a tool button.
  // We find it by aria-label since class names are minified.
  sendButton: 'button[aria-label="Send message"]',

  // Fallback: any button with type submit inside the form
  sendButtonFallback: 'form button[type="submit"]',
};

/**
 * Finds the active chat input element.
 * @returns {Element|null}
 */
function findInput() {
  return (
    document.querySelector(SELECTORS.input) ||
    document.querySelector(SELECTORS.inputFallback)
  );
}

/**
 * Finds the send button.
 * @returns {Element|null}
 */
function findSendButton() {
  return (
    document.querySelector(SELECTORS.sendButton) ||
    document.querySelector(SELECTORS.sendButtonFallback)
  );
}

/**
 * Injects text into a contenteditable div in a way React recognises.
 * Clears existing content first, then inserts the new text.
 * @param {Element} el - The contenteditable element
 * @param {string} text
 */
function injectIntoContentEditable(el, text) {
  el.click(); // ProseMirror needs a click to initialize cursor, not just focus()
  el.focus();
  document.execCommand('selectAll', false, null);
  document.execCommand('insertText', false, text);
}

/**
 * Injects text into a <textarea> in a way React recognises.
 * Uses the nativeInputValueSetter trick to bypass React's synthetic wrapper.
 * @param {Element} el - The textarea element
 * @param {string} text
 */
function injectIntoTextarea(el, text) {
  const nativeSetter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    "value"
  ).set;

  el.focus();
  nativeSetter.call(el, text);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

/**
 * Main export. Injects `text` into claude.ai's chat input and clicks send.
 *
 * @param {string} text - The fully-formed message to inject
 * @returns {boolean} - true if injection succeeded, false if input not found
 */
export function injectAndSend(text) {
  const input = findInput();

  if (!input) {
    console.warn("[CIR] Could not find chat input. Selectors may need updating.");
    return false;
  }

  if (input.tagName === "TEXTAREA") {
    injectIntoTextarea(input, text);
  } else {
    injectIntoContentEditable(input, text);
  }

  // Small delay — React needs one tick to process the input event and
  // enable the send button before we click it.
  setTimeout(() => {
    const sendBtn = findSendButton();

    if (!sendBtn) {
      console.warn("[CIR] Could not find send button. Selectors may need updating.");
      return;
    }

    if (sendBtn.disabled) {
      console.warn("[CIR] Send button is still disabled after input injection. React may not have picked up the change.");
      return;
    }

    sendBtn.click();
  }, 50);

  return true;
}
