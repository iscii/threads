# threads
threads extension for claude, chatgpt, deepseek

## Dev Debug Logging

Debug logs are stripped behind Vite dev mode and are opt-in per channel. Logs
should be added only for state transitions, lifecycle boundaries, and failure
or skipped-work modes. In the page console, enable one or more channels before
reproducing an issue:

```js
window.__THREADS_DEBUG__ = ['dom', 'fetch-watcher']
```

For refresh-persistent debugging in the current tab:

```js
sessionStorage.setItem('threads:debug', 'dom,fetch-watcher')
```

Use `dom` for content-script rendering, observer, and thread-position logs. Use
`fetch-watcher` for request interception, summary injection, and stream lifecycle
logs. Fetch watcher logs only include request metadata, body shape, and header
names; they do not log full bodies or header values.

Available channels:

- `app`: content entrypoint, platform mounting, and badge mounting.
- `dom`: DOM observer, injector, and thread positioning.
- `endpoint`: endpoint capture, storage, reconstruction, and same-origin checks.
- `fetch-watcher`: fetch interception, summary injection, and stream lifecycle.
- `platform`: Claude-specific DOM/network adapter decisions.
- `queue`: thread reply request lifecycle.
- `summary`: dirty thread detection, summarization, coverage, and summary queue.
- `threads`: thread state and storage lifecycle.
