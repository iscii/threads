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

  const computeRef = useRef<() => void>(() => {})
  computeRef.current = () => {
    const scrollEl = domAdapter.findScrollContainer()
    const atTop = !scrollEl || scrollEl.scrollTop < 2

    const geoms: PanelGeometry[] = openThreads.value.map(t => ({
      id: t.id,
      top: coordinator.getBlockTop(t.blockId),
      height: panelRefs.current.get(t.id)?.offsetHeight ?? 200,
    }))

    setPositions(resolveCollisions(geoms, {
      maxBottom: coordinator.getZoneHeight(),
      minTop: atTop ? 0 : undefined,
    }))
  }
  const compute = useCallback(() => computeRef.current(), [])

  const registerRef = useCallback((id: string, el: HTMLElement) => {
    panelRefs.current.set(id, el)
    compute()
  }, [compute])

  useSignalEffect(() => {
    threads.value
    compute()
  })

  useEffect(() => {
    // capture:true catches scroll events on any descendant (scroll container may not exist at mount)
    window.addEventListener('scroll', compute, true)
    window.addEventListener('resize', compute)
    return () => {
      window.removeEventListener('scroll', compute, true)
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
