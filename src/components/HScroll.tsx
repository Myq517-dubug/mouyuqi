/**
 * 横滑行容器——左右滑动按钮（品牌红描边 + 半透明毛玻璃），首尾自动禁用。
 * 从原 pages.tsx 迁移，逻辑一字不改。
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

export function HScroll({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [atStart, setAtStart] = useState(true)
  const [atEnd, setAtEnd] = useState(false)
  const update = useCallback(() => {
    const el = ref.current
    if (!el) return
    setAtStart(el.scrollLeft <= 8)
    setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 8)
  }, [])
  useEffect(() => {
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [update])
  const scroll = (dir: number) => {
    const el = ref.current
    if (!el) return
    el.scrollBy({ left: dir * Math.max(320, el.clientWidth * 0.8), behavior: 'smooth' })
  }
  return (
    <div className="hscroll-wrap">
      <button className="hscroll-nav left" onClick={() => scroll(-1)} disabled={atStart} aria-label="向左滑动">
        ‹
      </button>
      <div className="hscroll" ref={ref} onScroll={update}>
        {children}
      </div>
      <button className="hscroll-nav right" onClick={() => scroll(1)} disabled={atEnd} aria-label="向右滑动">
        ›
      </button>
    </div>
  )
}
