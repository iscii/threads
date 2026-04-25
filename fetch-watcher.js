(function () {
  const COMPLETION_RE = /\/api\/organizations\/[^/]+\/chat_conversations\/[^/]+\/completion/;
  const _fetch = window.fetch;
  let stagedSummaries = [];

  window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    if (e.data?.type === 'THR_STAGE_SUMMARY') {
      stagedSummaries = e.data.summaryTexts ?? [];
    }
  });

  window.fetch = async function (input, init = {}) {
    const url = typeof input === 'string' ? input
              : input instanceof Request ? input.url
              : String(input);
    const method = (init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();

    if (COMPLETION_RE.test(url) && method === 'POST') {
      let bodyTemplate = null;
      try { bodyTemplate = JSON.parse(init.body); } catch (_) {}

      // Post original body as template (before summary injection)
      window.postMessage({ type: 'THR_ENDPOINT_CAPTURED', url, bodyTemplate }, location.origin);

      // Inject staged summaries if present
      let modifiedInit = init;
      let injected = false;
      if (stagedSummaries.length > 0 && bodyTemplate) {
        const contextPrefix = stagedSummaries.join('\n') + '\n\n';
        const freshUuids = bodyTemplate.turn_message_uuids ? {
          turn_message_uuids: {
            human_message_uuid: crypto.randomUUID(),
            assistant_message_uuid: crypto.randomUUID(),
          },
        } : {};

        let updatedBody = null;
        if (Array.isArray(bodyTemplate.messages)) {
          const msgs = [...bodyTemplate.messages];
          const lastUserIdx = msgs.map(m => m.role).lastIndexOf('user');
          if (lastUserIdx === -1) {
            console.warn('[Thread] No user message found — skipping summary injection');
            // injected stays false, stagedSummaries not cleared
          } else {
            msgs[lastUserIdx] = { ...msgs[lastUserIdx], content: contextPrefix + msgs[lastUserIdx].content };
            updatedBody = { ...bodyTemplate, ...freshUuids, messages: msgs };
          }
        } else if (typeof bodyTemplate.prompt === 'string') {
          const marker = '\n\nHuman: ';
          const lastHuman = bodyTemplate.prompt.lastIndexOf(marker);
          updatedBody = lastHuman !== -1
            ? { ...bodyTemplate, ...freshUuids, prompt:
                bodyTemplate.prompt.slice(0, lastHuman) + marker + contextPrefix +
                bodyTemplate.prompt.slice(lastHuman + marker.length) }
            : { ...bodyTemplate, ...freshUuids };
        } else {
          updatedBody = null;
        }

        if (updatedBody !== null) {
          modifiedInit = { ...init, body: JSON.stringify(updatedBody) };
          stagedSummaries = [];
          injected = true;
        }
      }

      const response = await _fetch.call(this, input, modifiedInit);
      if (injected) window.postMessage({ type: 'THR_SUMMARY_INJECTED' }, location.origin);
      const [s1, s2] = response.body.tee();

      (async () => {
        const reader = s2.getReader();
        try { while (!(await reader.read()).done) {} } finally {
          reader.releaseLock();
          window.postMessage({ type: 'THR_STREAM_COMPLETE' }, location.origin);
        }
      })();

      return new Response(s1, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    }

    return _fetch.apply(this, arguments);
  };
})();
