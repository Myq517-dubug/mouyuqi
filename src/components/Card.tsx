/**
 * 内容卡片（海报网格单元）。
 * 从原 pages.tsx 迁移，逻辑一字不改。
 */

import type { SearchResult } from '../types'

export function Card({
  item,
  onOpen,
  onAddPlaylist,
  inPlaylist
}: {
  item: SearchResult
  onOpen: (i: SearchResult) => void
  onAddPlaylist?: (i: SearchResult) => void
  inPlaylist?: boolean
}) {
  return (
    <div className="card" onClick={() => onOpen(item)}>
      <div
        className="poster"
        style={item.poster ? { backgroundImage: `url(${item.poster})` } : undefined}
      >
        {item.poster ? '' : item.title}
        {onAddPlaylist && (
          <button
            className={'card-add' + (inPlaylist ? ' added' : '')}
            title={inPlaylist ? '已在片单' : '加入片单'}
            onClick={(e) => {
              e.stopPropagation()
              onAddPlaylist(item)
            }}
          >
            {inPlaylist ? '✓' : '＋'}
          </button>
        )}
      </div>
      <div className="meta">
        <div className="t">{item.title}</div>
        <div className="d">{item.description || ''}</div>
        <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <span className="tag">{item.provider}</span>
          {item.year && <span className="tag">{item.year}</span>}
          {item.rating && <span className="tag rating-tag">★ {item.rating}</span>}
          {item.sources && item.sources.length > 1 && (
            <span className="tag">{item.sources.length} 源</span>
          )}
          {(() => {
            const sp = (item.sources || [])
              .map((s) => s.speed)
              .filter((s): s is number => s !== undefined && s >= 0)
            if (!sp.length) return null
            const min = Math.min(...sp)
            return (
              <span className={'tag speed-tag ' + (min < 800 ? 'good' : 'mid')}>
                最快 {min}ms
              </span>
            )
          })()}
        </div>
      </div>
    </div>
  )
}
