// ── State ─────────────────────────────────────────────────────────────
let endpointInfo = null;  // { url, bodyTemplate }

// ── Sidebar state ─────────────────────────────────────────────────────
let sidebarEl = null;
let sidebarThreadEl = null;
let sidebarInputEl = null;
let activePara = null;  // { para, paragraphIdx, responseIdx, icon, hash, hashPromise }

function ensureSidebar() {
  if (sidebarEl) return;
  sidebarEl = document.createElement('div');
  sidebarEl.id = 'thr-sidebar';
  sidebarEl.innerHTML = `
    <div id="thr-sidebar-header">
      <span>Thread</span>
      <button id="thr-close" aria-label="Close sidebar">✕</button>
    </div>
    <div id="thr-quote"></div>
    <div id="thr-thread"></div>
    <div id="thr-compose">
      <textarea id="thr-input" placeholder="Reply to this paragraph… (Ctrl+Enter to send)" rows="3"></textarea>
      <button id="thr-send">Send</button>
    </div>
  `;
  document.body.appendChild(sidebarEl);
  document.getElementById('thr-close').addEventListener('click', closeSidebar);
  document.getElementById('thr-send').addEventListener('click', handleSend);
  sidebarThreadEl = document.getElementById('thr-thread');
  sidebarInputEl = document.getElementById('thr-input');
  sidebarInputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleSend();
  });
}

function openSidebar() {
  ensureSidebar();
  sidebarEl.classList.add('thr-open');
  // Dynamically nudge the chat content container
  const chatEl = document.querySelector('main, [class*="conversation"], [class*="chat-content"]');
  if (chatEl && !chatEl.dataset.thrNudged) {
    chatEl.style.transition = 'padding-right 0.25s ease';
    chatEl.style.paddingRight = '420px';
    chatEl.dataset.thrNudged = '1';
    sidebarEl._chatEl = chatEl;
  }
}

function closeSidebar() {
  if (!sidebarEl) return;
  sidebarEl.classList.remove('thr-open');
  if (sidebarEl._chatEl) {
    sidebarEl._chatEl.style.paddingRight = '';
    delete sidebarEl._chatEl.dataset.thrNudged;
    sidebarEl._chatEl = null;
  }
  activePara = null;
}

function renderThread(turns) {
  sidebarThreadEl.innerHTML = '';
  for (const turn of turns) {
    const div = document.createElement('div');
    div.className = `thr-turn thr-turn-${turn.role}`;
    div.textContent = turn.content;
    sidebarThreadEl.appendChild(div);
  }
  sidebarThreadEl.scrollTop = sidebarThreadEl.scrollHeight;
}

// ── DOM selectors ─────────────────────────────────────────────────────
// Update RESPONSE_SELECTOR based on Step 1 inspection results.
const RESPONSE_SELECTOR = '.font-claude-message, [data-is-streaming], [class*="prose"]';
const PARAGRAPH_SELECTOR = 'p, h1, h2, h3, h4, h5, h6';
const INJECTED_ATTR = 'data-thr-injected';

// ── Storage stubs (implemented in Task 6) ────────────────────────────
function convIdFromUrl() { return location.pathname.match(/\/chat\/([^/]+)/)?.[1] ?? null; }
async function hashParagraph(text) { return 'stub'; }
async function loadThread() { return []; }

// ── Receive fetch-watcher events ──────────────────────────────────────
window.addEventListener('message', (e) => {
  if (e.source !== window) return;
  if (!e.data?.type?.startsWith('THR_')) return;

  if (e.data.type === 'THR_ENDPOINT_CAPTURED') {
    endpointInfo = { url: e.data.url, bodyTemplate: e.data.bodyTemplate };
  }
  if (e.data.type === 'THR_STREAM_COMPLETE') {
    setTimeout(processNewResponse, 150);
  }
});

// ── Paragraph icon injection ──────────────────────────────────────────
function processNewResponse() {
  const responses = document.querySelectorAll(RESPONSE_SELECTOR);
  if (!responses.length) return;
  const latest = responses[responses.length - 1];
  if (latest.getAttribute(INJECTED_ATTR)) return;
  latest.setAttribute(INJECTED_ATTR, 'true');
  latest.querySelectorAll(PARAGRAPH_SELECTOR)
    .forEach((para, idx) => injectIcon(para, idx));
}

function injectIcon(para, paragraphIdx) {
  const wrapper = document.createElement('div');
  wrapper.className = 'thr-para-wrapper';
  para.parentNode.insertBefore(wrapper, para);
  wrapper.appendChild(para);

  const icon = document.createElement('button');
  icon.className = 'thr-icon';
  icon.setAttribute('aria-label', 'Open reply thread');
  icon.setAttribute('data-para-idx', paragraphIdx);
  icon.textContent = '💬';
  icon.addEventListener('click', () => openThread(para, paragraphIdx, icon));
  wrapper.appendChild(icon);
}

function openThread(para, paragraphIdx, icon) {
  const allResponses = [...document.querySelectorAll(RESPONSE_SELECTOR)];
  const responseEl = para.closest(RESPONSE_SELECTOR);
  const responseIdx = allResponses.indexOf(responseEl);

  const hashPromise = hashParagraph(para.textContent);
  activePara = { para, paragraphIdx, responseIdx, icon, hash: null, hashPromise };
  hashPromise.then(h => { if (activePara) activePara.hash = h; });

  openSidebar();

  const quoteText = para.textContent;
  document.getElementById('thr-quote').textContent =
    `"${quoteText.slice(0, 140)}${quoteText.length > 140 ? '…' : ''}"`;

  sidebarInputEl.value = '';
  renderThread([]);
  sidebarInputEl.focus();

  // Load existing thread turns once hash resolves
  const convId = convIdFromUrl();
  hashPromise.then(async (hash) => {
    const turns = await loadThread(convId, responseIdx, hash);
    renderThread(turns);
  });
}

function handleSend() {
  const text = sidebarInputEl.value.trim();
  if (!text) return;
  console.log('[Thread] send (not yet wired):', text);
  sidebarInputEl.value = '';
}
