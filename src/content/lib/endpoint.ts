export function sameOriginURL(url: string): string | null {
  try {
    const parsed = new URL(url, location.href)
    return parsed.origin === location.origin ? parsed.toString() : null
  } catch {
    return null
  }
}
