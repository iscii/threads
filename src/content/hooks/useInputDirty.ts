import { useEffect } from 'preact/hooks'
import { endpointInfo } from '../lib/threads'
import { dirtyThreads } from '../lib/summaryStore'
import { triggerSummarization } from './useSummary'
import type { DOMAdapter } from '@/types'

export function useInputDirty(domAdapter: DOMAdapter): void {
  useEffect(() => {
    const input = domAdapter.findInput()
    if (!input) return

    let inFlight = false

    const handler = () => {
      if (inFlight || dirtyThreads().length === 0 || !endpointInfo.value) return
      inFlight = true
      triggerSummarization().finally(() => { inFlight = false })
    }

    input.addEventListener('input', handler)
    return () => input.removeEventListener('input', handler)
  }, [])
}
