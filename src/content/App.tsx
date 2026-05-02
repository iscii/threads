import { useState, useEffect, useCallback } from 'preact/hooks'
import { useComputed } from '@preact/signals'
import { threads, setActive } from './lib/threads'
import { ThreadPanel } from './components/Thread'
import { useObserver } from './hooks/useObserver'
import { useInputDirty } from './hooks/useInputDirty'
import type { Coordinator } from './lib/adapter'
import type { DOMAdapter } from '@/types'

interface AppProps {
  coordinator: Coordinator
  domAdapter: DOMAdapter
}

export function App({ coordinator, domAdapter }: AppProps) {
  const openThreads = useComputed(() => threads.value.filter(t => t.isOpen))
  const [, setTick] = useState(0)
  const rerender = useCallback(() => setTick(n => n + 1), [])

  useEffect(() => {
    window.addEventListener('scroll', rerender, true)
    window.addEventListener('resize', rerender)
    return () => {
      window.removeEventListener('scroll', rerender, true)
      window.removeEventListener('resize', rerender)
    }
  }, [rerender])

  useObserver(coordinator)
  useInputDirty(domAdapter)

  useEffect(() => {
    const handler = () => setActive(null)
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const scrollToBlock = useCallback((blockId: string) => {
    const block = document.querySelector(`[data-thr-id="${blockId}"]`)
    block?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  return (
    <>
      {openThreads.value.map(t => (
        <ThreadPanel
          key={t.id}
          thread={t}
          top={coordinator.getBlockTop(t.blockId)}
          onScrollToBlock={() => scrollToBlock(t.blockId)}
        />
      ))}
    </>
  )
}
