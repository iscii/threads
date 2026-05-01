import { useEffect } from 'preact/hooks'
import type { Coordinator } from '../lib/adapter'

export function useObserver(coordinator: Coordinator): void {
  useEffect(() => {
    coordinator.start()
    return () => coordinator.stop()
  }, [])
}
