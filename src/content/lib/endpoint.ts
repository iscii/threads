import { createDebugLogger } from '@/debug'

const debug = createDebugLogger('endpoint')

export function sameOriginURL(url: string): string | null {
  try {
    const parsed = new URL(url, location.href)
    if (parsed.origin !== location.origin) {
      debug.warn('same-origin url rejected', () => ({
        endpointOrigin: parsed.origin,
        pageOrigin: location.origin,
      }))
      return null
    }
    return parsed.toString()
  } catch {
    debug.warn('same-origin url parse failed')
    return null
  }
}
