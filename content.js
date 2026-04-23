// ── State ─────────────────────────────────────────────────────────────
let endpointInfo = null;  // { url, bodyTemplate }

// ── Sidebar state ─────────────────────────────────────────────────────
let sidebarEl = null;
let sidebarThreadEl = null;
let sidebarInputEl = null;
let activePara = null;  // { para, paragraphIdx, responseIdx, icon, hash, hashPromise }

function ensureSidebar() {
  if (sidebarEl && document.body.contains(sidebarEl)) return;
  if (sidebarEl) {
    sidebarEl = null;
    sidebarThreadEl = null;
    sidebarInputEl = null;
  }
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
    chatEl.dataset.thrPrevTransition = chatEl.style.transition;
    chatEl.style.transition = chatEl.style.transition
      ? chatEl.style.transition + ', padding-right 0.25s ease'
      : 'padding-right 0.25s ease';
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
    sidebarEl._chatEl.style.transition = sidebarEl._chatEl.dataset.thrPrevTransition ?? '';
    delete sidebarEl._chatEl.dataset.thrNudged;
    delete sidebarEl._chatEl.dataset.thrPrevTransition;
    sidebarEl._chatEl = null;
  }
  if (sidebarThreadEl) sidebarThreadEl.innerHTML = '';
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

// ── Storage ───────────────────────────────────────────────────────────

function convIdFromUrl() {
  return location.pathname.match(/\/chat\/([^/]+)/)?.[1] ?? null;
}

async function hashParagraph(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

function storageKey(convId, msgIdx, paragraphHash) {
  return `threads:${convId}:${msgIdx}:${paragraphHash}`;
}

async function saveThread(convId, msgIdx, paragraphHash, turns) {
  const key = storageKey(convId, msgIdx, paragraphHash);
  try {
    await chrome.storage.local.set({ [key]: { paragraphHash, turns } });
  } catch (err) {
    console.warn('[Thread] storage write failed:', err.message);
  }
}

async function loadThread(convId, msgIdx, paragraphHash) {
  const key = storageKey(convId, msgIdx, paragraphHash);
  try {
    const result = await chrome.storage.local.get(key);
    return result[key]?.turns ?? [];
  } catch (err) {
    console.warn('[Thread] storage read failed:', err.message);
    return [];
  }
}

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

  const token = {};
  const hashPromise = hashParagraph(para.textContent);
  activePara = { para, paragraphIdx, responseIdx, icon, hash: null, hashPromise, _token: token };
  hashPromise.then(h => { if (activePara?._token === token) activePara.hash = h; });

  openSidebar();

  const quoteText = para.textContent;
  const quoteEl = document.getElementById('thr-quote');
  if (quoteEl) quoteEl.textContent = `"${quoteText.slice(0, 140)}${quoteText.length > 140 ? '…' : ''}"`;

  sidebarInputEl.value = '';
  renderThread([]);
  sidebarInputEl.focus();

  const convId = convIdFromUrl();
  hashPromise.then(async (hash) => {
    if (activePara?._token !== token) return;
    const turns = await loadThread(convId, responseIdx, hash);
    if (activePara?._token !== token) return;
    renderThread(turns);
  });
}

// ── Thread API ────────────────────────────────────────────────────────

function buildThreadRequest(paraText, userInput, existingTurns) {
  if (!endpointInfo) {
    throw new Error('No Claude.ai endpoint captured yet — send a message in the main chat first.');
  }
  const { url, bodyTemplate } = endpointInfo;
  const contextTurn = `Focusing on this specific part of your response: "${paraText}"\n\n${userInput}`;

  let updatedBody;
  if (Array.isArray(bodyTemplate.messages)) {
    // Messages API format (most likely)
    updatedBody = {
      ...bodyTemplate,
      messages: [
        ...bodyTemplate.messages,
        ...existingTurns,
        { role: 'user', content: contextTurn },
      ],
    };
  } else if (typeof bodyTemplate.prompt === 'string') {
    // Human/Assistant prompt format (older models)
    const threadHistory = existingTurns.map(t =>
      t.role === 'user' ? `\n\nHuman: ${t.content}` : `\n\nAssistant: ${t.content}`
    ).join('');
    updatedBody = {
      ...bodyTemplate,
      prompt: bodyTemplate.prompt + threadHistory + `\n\nHuman: ${contextTurn}\n\nAssistant:`,
    };
  } else {
    throw new Error('Unrecognised Claude.ai request format — inspect console.log(endpointInfo.bodyTemplate)');
  }

  return { url, body: JSON.stringify(updatedBody) };
}

async function streamThreadReply(url, body, onChunk) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body,
  });
  if (!response.ok) throw new Error(`API ${response.status}: ${response.statusText}`);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let accumulated = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const line of decoder.decode(value, { stream: true }).split('\n')) {
      if (!line.startsWith('data: ')) continue;
      const payload = line.slice(6).trim();
      if (payload === '[DONE]') continue;
      try {
        const parsed = JSON.parse(payload);
        const token =
          parsed.completion ??           // older Anthropic format
          parsed.delta?.text ??          // messages streaming format
          parsed.choices?.[0]?.delta?.content ?? // OpenAI-compat
          '';
        if (token) { accumulated += token; onChunk(accumulated); }
      } catch (_) {}
    }
  }
  return accumulated;
}

function updateBadge(icon, userTurnCount) {
  icon.setAttribute('data-has-thread', 'true');
  let badge = icon.querySelector('.thr-badge');
  if (!badge) {
    badge = document.createElement('span');
    badge.className = 'thr-badge';
    icon.appendChild(badge);
  }
  badge.textContent = userTurnCount;
}

async function handleSend() {
  const text = sidebarInputEl.value.trim();
  if (!text || !activePara) return;

  const sendBtn = document.getElementById('thr-send');
  sendBtn.disabled = true;
  sidebarInputEl.disabled = true;

  // Ensure hash is computed before proceeding
  const hash = activePara.hash ?? await activePara.hashPromise;
  const convId = convIdFromUrl();
  const { para, responseIdx, icon } = activePara;

  const existingTurns = await loadThread(convId, responseIdx, hash);
  const userTurn = { role: 'user', content: text };

  renderThread([...existingTurns, userTurn]);
  sidebarInputEl.value = '';

  const streamingDiv = document.createElement('div');
  streamingDiv.className = 'thr-turn thr-turn-assistant';
  streamingDiv.textContent = '…';
  sidebarThreadEl.appendChild(streamingDiv);
  sidebarThreadEl.scrollTop = sidebarThreadEl.scrollHeight;

  try {
    const { url, body } = buildThreadRequest(para.textContent, text, existingTurns);
    const finalText = await streamThreadReply(url, body, (partial) => {
      streamingDiv.textContent = partial;
      sidebarThreadEl.scrollTop = sidebarThreadEl.scrollHeight;
    });

    const updatedTurns = [...existingTurns, userTurn, { role: 'assistant', content: finalText }];
    await saveThread(convId, responseIdx, hash, updatedTurns);
    if (icon) updateBadge(icon, updatedTurns.filter(t => t.role === 'user').length);
  } catch (err) {
    streamingDiv.textContent = `Error: ${err.message}`;
    streamingDiv.style.color = '#f87171';
  } finally {
    sendBtn.disabled = false;
    sidebarInputEl.disabled = false;
    sidebarInputEl.focus();
  }
}
