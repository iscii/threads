export async function accumulateSSE(response: Response): Promise<string> {
  if (!response.body) return ''

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let accumulated = ''
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const payload = line.slice(6).trim()
        if (payload === '[DONE]') return accumulated

        try {
          const parsed = JSON.parse(payload) as Record<string, unknown>
          // Claude.ai uses `completion`; Anthropic messages API uses `delta.text`
          const token =
            (typeof parsed.completion === 'string' ? parsed.completion : null) ??
            (typeof (parsed.delta as Record<string, unknown>)?.text === 'string'
              ? (parsed.delta as Record<string, unknown>).text as string
              : null) ??
            ''
          if (token) accumulated += token
        } catch {
          // malformed SSE line — skip
        }
      }
    }
  } finally {
    reader.releaseLock()
  }

  return accumulated
}
