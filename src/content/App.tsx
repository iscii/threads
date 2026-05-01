import { useRef, useState, useEffect, useCallback } from 'preact/hooks'
import { useComputed, useSignalEffect } from '@preact/signals'
import { threads, setActive } from './lib/threads'
import { resolveCollisions, type PanelGeometry } from './lib/positions'
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
  const panelRefs = useRef<Map<string, HTMLElement>>(new Map())
  const [positions, setPositions] = useState<Record<string, number>>({})

  const compute = useCallback(() => {
    const geoms: PanelGeometry[] = openThreads.value.map(t => ({
      id: t.id,
      top: coordinator.getBlockTop(t.blockId),
      height: panelRefs.current.get(t.id)?.offsetHeight ?? 200,
    }))
    setPositions(resolveCollisions(geoms))
  }, [openThreads.value, coordinator])

  const registerRef = useCallback((id: string, el: HTMLElement) => {
    panelRefs.current.set(id, el)
    compute()
  }, [compute])

  useSignalEffect(() => {
    threads.value
    compute()
  })

  useEffect(() => {
    const sc = document.querySelector('[data-autoscroll-container]')
    sc?.addEventListener('scroll', compute)
    window.addEventListener('resize', compute)
    return () => {
      sc?.removeEventListener('scroll', compute)
      window.removeEventListener('resize', compute)
    }
  }, [compute])

  useObserver(coordinator)
  useInputDirty(domAdapter)

  useEffect(() => {
    const handler = () => setActive(null)
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <>
      {openThreads.value.map(t => (
        <ThreadPanel
          key={t.id}
          thread={t}
          top={positions[t.id] ?? coordinator.getBlockTop(t.blockId)}
          registerRef={registerRef}
        />
      ))}
    </>
  )
}
