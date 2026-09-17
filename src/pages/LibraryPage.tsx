/**
 * 收藏 / 历史页（LibraryPage）。
 * 从原 pages.tsx 迁移，逻辑一字不改；共享组件 Card 来自 ../components。
 */

import type { AppData, SearchResult } from '../types'
import { Card } from '../components'

export function LibraryPage({
  data,
  onOpen,
  onRemoveFav,
  onRemoveHistory
}: {
  data: AppData
  onOpen: (i: SearchResult) => void
  onRemoveFav: (i: SearchResult) => void
  onRemoveHistory: (id: string) => void
}) {
  const hist = Object.values(data.history).sort((a, b) => b.updatedAt - a.updatedAt)
  return (
    <>
      <div className="page-head"><h2>收藏 / 历史</h2></div>
      <h3 style={{ fontSize: 14, color: 'var(--text-dim)' }}>收藏 ({data.favorites.length})</h3>
      {data.favorites.length === 0 ? (
        <div className="empty">还没有收藏，去首页或搜索里点"收藏"吧</div>
      ) : (
        <div className="grid">
          {data.favorites.map((it) => (
            <Card key={it.id} item={it} onOpen={onOpen} />
          ))}
        </div>
      )}
      <h3 style={{ fontSize: 14, color: 'var(--text-dim)', marginTop: 18 }}>观看历史（点击续播）</h3>
      {hist.length === 0 ? (
        <div className="empty">暂无观看记录</div>
      ) : (
        <div className="grid">
          {hist.map((h) => {
            const pct = h.duration ? Math.round((h.progress / h.duration) * 100) : 0
            return (
              <div key={h.item.id} className="card" onClick={() => onOpen(h.item)}>
                <div
                  className="poster"
                  style={h.item.poster ? { backgroundImage: `url(${h.item.poster})` } : undefined}
                >
                  {h.item.poster ? '' : h.item.title}
                </div>
                <div className="meta">
                  <div className="t">{h.item.title}</div>
                  <div className="d">看到 {pct}%</div>
                  <div className="progress-bar" style={{ marginTop: 6 }}>
                    <div style={{ width: pct + '%' }} />
                  </div>
                  <button
                    className="btn sm danger"
                    style={{ marginTop: 6 }}
                    onClick={(e) => {
                      e.stopPropagation()
                      onRemoveHistory(h.item.id)
                    }}
                  >
                    删除记录
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}
