/**
 * 横滑卡片（猜你喜欢 / 最近更新 / 高评分 区块用）。
 * 从原 pages.tsx 迁移，逻辑一字不改。
 */

import type { SearchResult } from '../types'

export function MiniCard({
  item,
  onOpen
}: {
  item: SearchResult
  onOpen: (i: SearchResult) => void
}) {
  return (
    <div className="hcard" onClick={() => onOpen(item)}>
      <div
        className="poster"
        style={item.poster ? { backgroundImage: `url(${item.poster})` } : undefined}
      >
        {item.poster ? '' : item.title}
      </div>
      <div className="t">{item.title}</div>
    </div>
  )
}
