import { useEffect } from 'preact/hooks'
import { endpointInfo } from '../lib/threads'
import { dirtyThreads } from '../lib/summaryStore'
import { triggerSummarization } from './useSummary'
import type { DOMAdapter } from '@/types'
import { createDebugLogger } from '@/debug'

const debug = createDebugLogger('summary')

export function useInputDirty(domAdapter: DOMAdapter): void {
  useEffect(() => {
    const input = domAdapter.findInput()
    if (!input) {
      debug.warn('input dirty observer skipped missing input')
      return
    }

    let inFlight = false

    const handler = () => {
      const dirtyCount = dirtyThreads().length
      if (inFlight || dirtyCount === 0 || !endpointInfo.value) {
        return
      }
      inFlight = true
      debug.log('input dirty event triggered summarization', () => ({ dirtyCount }))
      triggerSummarization().finally(() => { inFlight = false })
    }

    input.addEventListener('input', handler)
    debug.log('input dirty observer attached')
    return () => {
      input.removeEventListener('input', handler)
      debug.log('input dirty observer detached')
    }
  }, [])
}
