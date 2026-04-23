(function () {
  const COMPLETION_RE = /\/api\/organizations\/[^/]+\/chat_conversations\/[^/]+\/completion/;
  const _fetch = window.fetch;

  window.fetch = async function (input, init = {}) {
    const url = typeof input === 'string' ? input
              : input instanceof Request ? input.url
              : String(input);
    const method = (init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();

    if (COMPLETION_RE.test(url) && method === 'POST') {
      let bodyTemplate = null;
      try { bodyTemplate = JSON.parse(init.body); } catch (_) {}

      window.postMessage({ type: 'THR_ENDPOINT_CAPTURED', url, bodyTemplate }, location.origin);

      // Call original fetch and tee the response stream to detect completion
      const response = await _fetch.apply(this, arguments);
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
