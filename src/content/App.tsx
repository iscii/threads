import { useState, useEffect, useCallback } from 'preact/hooks'
import { useComputed } from '@preact/signals'
import { threads, activeId, setActive } from './lib/threads'
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

  return (
    <>
      {openThreads.value.map(t => {
        const top = coordinator.getBlockTop(t.blockId)
        const isActive = activeId.value === t.id
        return [
          <button
            key={`tab-${t.id}`}
            class={`tp-tab${isActive ? ' active' : ''}`}
            style={{ top: `${top}px` }}
            onMouseDown={e => { e.stopPropagation(); setActive(t.id) }}
          />,
          <ThreadPanel key={t.id} thread={t} top={top} />,
        ]
      })}
    </>
  )
}
