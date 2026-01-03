import { useCallback, useLayoutEffect, useState } from 'react'

interface Size {
  width: number
  height: number
}

export function useResizeObserver<T extends HTMLElement>() {
  const [size, setSize] = useState<Size>({ width: 0, height: 0 })
  const [node, setNode] = useState<T | null>(null)

  const ref = useCallback((instance: T | null) => {
    setNode(instance)
  }, [])

  useLayoutEffect(() => {
    if (!node) {
      return
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      setSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      })
    })

    observer.observe(node)
    return () => observer.disconnect()
  }, [node])

  return { ref, size }
}
