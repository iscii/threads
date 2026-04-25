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
const RESPONSE_SELECTOR = '.font-claude-message, [data-is-streaming], [class*="prose"]';
const PARAGRAPH_SELECTOR = 'p, h1, h2, h3, h4, h5, h6';
const INJECTED_ATTR = 'data-thr-injected';

// ── Summary utilities ─────────────────────────────────────────────────

function isDirtyThread(turns, excluded, highWaterMark, key) {
  if (excluded) return false;
  return turns.length > (highWaterMark[key] ?? 0);
}

function getDirtyTurns(turns, highWaterMark, key) {
  return turns.slice(highWaterMark[key] ?? 0);
}

function getParagraphSnippet(turns) {
  const firstUserContent = turns.find(t => t.role === 'user')?.content ?? '';
  const match = firstUserContent.match(/^Focusing on this specific part of your response: "([^"]{1,120})/);
  return match ? match[1] : firstUserContent.slice(0, 120);
}

function buildSummaryPrompt(dirtyItems) {
  const blocks = dirtyItems.map(({ paragraphSnippet, newTurns }) => {
    const lines = newTurns.map(t => `${t.role === 'user' ? 'Q' : 'A'}: ${t.content}`);
    return `Thread on: "${paragraphSnippet}"\nNew exchanges:\n${lines.join('\n')}`;
  }).join('\n\n');
  return [
    'Summarize the following thread exchanges from a Claude.ai conversation sidebar.',
    'Each thread is a follow-up question the user asked about a specific paragraph.',
    'For each thread, write one sentence in the format: "on [topic keyword], [summary]."',
    'Output only the sentences, no preamble.',
    '',
    blocks,
  ].join('\n');
}

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
  if (!convId) return;
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
  if (!bodyTemplate) {
    throw new Error('No request body captured — reload the page and send a message in the main chat first.');
  }
  const contextTurn = `Focusing on this specific part of your response: "${paraText}"\n\n${userInput}`;

  // Fresh UUIDs every call — reusing the captured ones causes 409 "already sent"
  const freshUuids = bodyTemplate.turn_message_uuids ? {
    turn_message_uuids: {
      human_message_uuid: crypto.randomUUID(),
      assistant_message_uuid: crypto.randomUUID(),
    },
  } : {};

  let updatedBody;
  if (Array.isArray(bodyTemplate.messages)) {
    // Messages API format (most likely)
    updatedBody = {
      ...bodyTemplate,
      ...freshUuids,
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
      ...freshUuids,
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
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // last element may be an incomplete line
      for (const line of lines) {
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
  } catch (err) {
    reader.cancel();
    throw err;
  } finally {
    reader.releaseLock();
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

  // Snapshot activePara before any await — closeSidebar() may null it during suspension
  const capturedPara = activePara;
  const hash = capturedPara.hash ?? await capturedPara.hashPromise;
  if (activePara !== capturedPara) { sendBtn.disabled = false; sidebarInputEl.disabled = false; return; }
  const convId = convIdFromUrl();
  if (!convId) { sendBtn.disabled = false; sidebarInputEl.disabled = false; return; }
  const { para, responseIdx, icon } = capturedPara;

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

    if (finalText) {
      const updatedTurns = [...existingTurns, userTurn, { role: 'assistant', content: finalText }];
      await saveThread(convId, responseIdx, hash, updatedTurns);
      if (icon) updateBadge(icon, updatedTurns.filter(t => t.role === 'user').length);
      streamingDiv.textContent = finalText;
    } else {
      streamingDiv.textContent = 'Error: empty response from API';
      streamingDiv.style.color = '#f87171';
    }
  } catch (err) {
    streamingDiv.textContent = `Error: ${err.message}`;
    streamingDiv.style.color = '#f87171';
  } finally {
    sendBtn.disabled = false;
    sidebarInputEl.disabled = false;
    sidebarInputEl.focus();
  }
}

// ── Persistence & SPA navigation ─────────────────────────────────────

async function restoreThreadBadges() {
  try {
    const convId = convIdFromUrl();
    if (!convId) return;

    const allKeys = await chrome.storage.local.get(null);
    if (convIdFromUrl() !== convId) return; // navigated away during storage await
    const prefix = `threads:${convId}:`;
    const matching = Object.entries(allKeys).filter(([k]) => k.startsWith(prefix));
    if (!matching.length) return;

    // Build map: responseIdx → [{ paragraphHash, turns }]
    const byResponse = {};
    for (const [key, val] of matching) {
      const rest = key.slice(prefix.length);            // "responseIdx:paragraphHash"
      const colon = rest.indexOf(':');
      const responseIdx = parseInt(rest.slice(0, colon), 10);
      const paragraphHash = rest.slice(colon + 1);
      if (!byResponse[responseIdx]) byResponse[responseIdx] = [];
      byResponse[responseIdx].push({ paragraphHash, turns: val.turns });
    }

    const allResponses = document.querySelectorAll(RESPONSE_SELECTOR);

    for (const [idxStr, threads] of Object.entries(byResponse)) {
      const msgIdx = parseInt(idxStr, 10);
      const responseEl = allResponses[msgIdx];
      if (!responseEl) continue;

      if (!responseEl.getAttribute(INJECTED_ATTR)) {
        responseEl.setAttribute(INJECTED_ATTR, 'true');
        responseEl.querySelectorAll(PARAGRAPH_SELECTOR).forEach((p, i) => injectIcon(p, i));
      }

      const paragraphs = [...responseEl.querySelectorAll(PARAGRAPH_SELECTOR)];

      for (const { paragraphHash, turns } of threads) {
        if (!turns?.length) continue;
        for (let i = 0; i < paragraphs.length; i++) {
          const h = await hashParagraph(paragraphs[i].textContent);
          if (h !== paragraphHash) continue;
          const icon = paragraphs[i].parentElement?.querySelector('.thr-icon');
          if (icon) updateBadge(icon, turns.filter(t => t.role === 'user').length);
          break;
        }
      }
    }
  } catch (err) {
    console.warn('[Thread] restoreThreadBadges failed:', err.message);
  }
}

// SPA navigation watcher — patches history API for reliable pushState/replaceState detection
let lastPathname = location.pathname;
let restoreTimerId = null;

function onNavigation() {
  if (location.pathname === lastPathname) return;
  lastPathname = location.pathname;
  endpointInfo = null;
  closeSidebar();
  clearTimeout(restoreTimerId);
  restoreTimerId = setTimeout(restoreThreadBadges, 500);
}

['pushState', 'replaceState'].forEach(method => {
  const orig = history[method].bind(history);
  history[method] = function (...args) {
    orig(...args);
    onNavigation();
  };
});
window.addEventListener('popstate', onNavigation);

// Initial load
restoreThreadBadges();
