import { Fragment } from 'preact'
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

  const forceUpdate = useCallback(() => {
    setTick(n => n + 1)
  }, [])

  useEffect(() => {
    window.addEventListener('scroll', forceUpdate, true)
    window.addEventListener('resize', forceUpdate)
    return () => {
      window.removeEventListener('scroll', forceUpdate, true)
      window.removeEventListener('resize', forceUpdate)
    }
  }, [forceUpdate])

  useObserver(coordinator)
  useInputDirty(domAdapter)

  return (
    <>
      {openThreads.value.map(t => {
        const top = coordinator.getBlockTop(t.blockId)
        const maxHeight = Math.max(120, window.innerHeight - top - 20)
        const isActive = activeId.value === t.id
        return (
          <Fragment key={t.id}>
            <button
              class={`tp-tab${isActive ? ' active' : ''}`}
              style={{ top: `${top}px` }}
              onMouseDown={e => { e.stopPropagation(); setActive(t.id) }}
            />
            <ThreadPanel thread={t} top={top} maxHeight={maxHeight} />
          </Fragment>
        )
      })}
    </>
  )
}
