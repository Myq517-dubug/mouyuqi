/**
 * 发现页（DiscoverPage）— 竖屏版（参照 Ardot 设计稿）。
 * 顶部大搜索框（点击进入完整搜索页）+ 分类网格 + 搜索历史。
 * 搜索能力复用现有 SearchPage（onGoSearch 跳转），分类复用 CategoryPage（onGoCategory）。
 */

import { useEffect, useState } from 'react'
import type { AppData } from '../types'
import { HOME_CATEGORIES } from '../providers'
import { getSearchHistory } from '../lib/searchHistory'

export function DiscoverPage({
  data,
  onGoSearch,
  onGoCategory,
  onToast
}: {
  data: AppData
  onGoSearch: () => void
  onGoCategory: (cat: { id: string; name: string }) => void
  onToast: (t: string) => void
}) {
  const [history, setHistory] = useState<string[]>([])
  useEffect(() => {
    setHistory(getSearchHistory())
  }, [])

  return (
    <div className="discover-page">
      {/* 大搜索框 */}
      <button className="discover-search" onClick={onGoSearch} aria-label="搜索">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.8-3.8" />
        </svg>
        <span>搜索影视 / 演员 / 片单</span>
      </button>

      {/* 搜索历史 */}
      {history.length > 0 && (
        <section className="feed-section">
          <div className="feed-section-head">
            <h3>搜索历史</h3>
            <span className="count">{history.length} 条</span>
          </div>
          <div className="discover-chips">
            {history.map((h, i) => (
              <button key={i} className="chip" onClick={onGoSearch}>
                {h}
              </button>
            ))}
          </div>
        </section>
      )}

      {/* 分类网格 */}
      <section className="feed-section">
        <div className="feed-section-head">
          <h3>全部分类</h3>
          <span className="count">{HOME_CATEGORIES.length} 类</span>
        </div>
        <div className="cat-grid">
          {HOME_CATEGORIES.map((c) => (
            <button key={c} className="cat-cell" onClick={() => onGoCategory({ id: c, name: c })}>
              <span className="cat-icon">
                {c.slice(0, 1)}
              </span>
              <span>{c}</span>
            </button>
          ))}
        </div>
      </section>

      <div className="hint" style={{ marginTop: 12, opacity: 0.6 }}>
        聚合 {data.settings.resourceSites.filter((s) => s.enabled).length} 个已启用资源站 · 支持错别字纠偏与拼音联想
      </div>
      <button
        className="btn ghost"
        style={{ marginTop: 8 }}
        onClick={() => onToast('更多发现能力敬请期待')}
      >
        更多玩法 ›
      </button>
    </div>
  )
}
