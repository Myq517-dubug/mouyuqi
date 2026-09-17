/**
 * 片单页（PlaylistPage）。
 * 从原 pages.tsx 迁移，逻辑一字不改；共享组件 Card 来自 ../components。
 */

import type { SearchResult } from '../types'
import { Card } from '../components'

export function PlaylistPage({
  items,
  onOpen,
  onRemove
}: {
  items: SearchResult[]
  onOpen: (i: SearchResult) => void
  onRemove: (id: string) => void
}) {
  return (
    <>
      <div className="page-head">
        <h2>片单（{items.length}）</h2>
        <span className="hint" style={{ alignSelf: 'center' }}>点击卡片即直接播放；右上角 ✕ 移除</span>
      </div>
      {items.length === 0 ? (
        <div className="empty">片单是空的。去「搜索聚合」输入关键词，点结果上的「＋」即可加入片单。</div>
      ) : (
        <div className="grid">
          {items.map((it) => (
            <div key={it.id} className="card" onClick={() => onOpen(it)}>
              <div
                className="poster"
                style={it.poster ? { backgroundImage: `url(${it.poster})` } : undefined}
              >
                {it.poster ? '' : it.title}
                <button
                  className="card-add added"
                  title="移出片单"
                  onClick={(e) => {
                    e.stopPropagation()
                    onRemove(it.id)
                  }}
                >
                  ✕
                </button>
              </div>
              <div className="meta">
                <div className="t">{it.title}</div>
                <div className="d">{it.description || ''}</div>
                <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <span className="tag">{it.provider}</span>
                  {it.sources && it.sources.length > 1 && (
                    <span className="tag">{it.sources.length} 源</span>
                  )}
                  <span className="tag" style={{ color: 'var(--accent)' }}>▶ 点击播放</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
