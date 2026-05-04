export type DebugChannel =
  | 'app'
  | 'dom'
  | 'endpoint'
  | 'fetch-watcher'
  | 'platform'
  | 'queue'
  | 'summary'
  | 'threads'

type DebugConfig =
  | boolean
  | string
  | string[]
  | Partial<Record<DebugChannel | '*', boolean>>

declare global {
  interface Window {
    __THREADS_DEBUG__?: DebugConfig
  }
}

export interface DebugLogger {
  log(event: string, details?: DebugDetails): void
  warn(event: string, details?: DebugDetails): void
}

type DebugDetails = unknown | (() => unknown)

export function createDebugLogger(channel: DebugChannel): DebugLogger {
  return {
    log(event, details) {
      if (!isEnabled(channel)) return
      write('log', channel, event, details)
    },
    warn(event, details) {
      if (!isEnabled(channel)) return
      write('warn', channel, event, details)
    },
  }
}

function write(
  level: 'log' | 'warn',
  channel: DebugChannel,
  event: string,
  details?: DebugDetails,
): void {
  const prefix = `[threads:${channel}] ${event}`
  if (details === undefined) {
    console[level](prefix)
    return
  }
  console[level](prefix, typeof details === 'function' ? details() : details)
}

function isEnabled(channel: DebugChannel): boolean {
  if (!import.meta.env.DEV) return false
  const config = window.__THREADS_DEBUG__ ?? readStoredConfig()
  return channelEnabled(config, channel)
}

function channelEnabled(config: DebugConfig | undefined, channel: DebugChannel): boolean {
  if (config === true) return true
  if (!config) return false

  if (typeof config === 'string') {
    return config === '*' || parseList(config).includes(channel)
  }

  if (Array.isArray(config)) {
    return config.includes('*') || config.includes(channel)
  }

  return config['*'] === true || config[channel] === true
}

function readStoredConfig(): DebugConfig | undefined {
  const raw = readBrowserStorage('threads:debug')
  if (!raw) return undefined

  try {
    return JSON.parse(raw) as DebugConfig
  } catch {
    return raw
  }
}

function readBrowserStorage(key: string): string | null {
  try {
    return window.sessionStorage?.getItem(key) ?? window.localStorage?.getItem(key) ?? null
  } catch {
    return null
  }
}

function parseList(value: string): string[] {
  return value.split(',').map(part => part.trim()).filter(Boolean)
}
