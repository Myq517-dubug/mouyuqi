/**
 * 首页（Home）— 竖屏版（参照 Ardot 设计稿）。
 * 结构：顶部 chip Tab（推荐/电影/剧集/综艺/动漫）
 *      → 主推大图轮播（hero）
 *      → 热播榜单（3 列网格）
 *      → 猜你喜欢（3 列网格）
 *      → 最近更新（横滑）
 * 数据逻辑（getHomeFeed / buildRecommendations / recentUpdated）保持原样。
 */

import { useEffect, useMemo, useState } from 'react'
import type { AppData, SearchResult, HomeFeed } from '../types'
import {
  getHomeFeed,
  HOME_CATEGORIES,
  buildRecommendations,
  recentUpdated
} from '../providers'
import { Card, MiniCard, HScroll, SkeletonGrid } from '../components'

export function Home({
  data,
  onOpen,
  onOpenCategory,
  onToast
}: {
  data: AppData
  onOpen: (i: SearchResult) => void
  onOpenCategory: (cat: { id: string; name: string }) => void
  onToast: (t: string) => void
}) {
  const [feed, setFeed] = useState<HomeFeed | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tab, setTab] = useState('推荐')
  const [recommendSeed, setRecommendSeed] = useState(0.42)
  // U8：手动刷新推荐（强制重新聚合，绕过缓存）
  const [refreshTick, setRefreshTick] = useState(0)

  // U8：首页推荐缓存 —— 本地持久化 + 6h TTL。
  // 切走再回来 / 重新打开 App：缓存命中直接显示，不重新聚合搜索；
  // 只有超过 TTL（"很久很久"）或资源站变更 / 手动刷新时才重新拉取。
  const FEED_TTL = 6 * 3600 * 1000
  const hashStr = (s: string) => {
    let h = 5381
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0
    return 'h' + h.toString(36)
  }
  const feedKey = () =>
    'mk:homefeed:' +
    hashStr(
      data.settings.resourceSites
        .filter((s) => s.enabled)
        .map((s) => s.api)
        .join('|')
    )

  useEffect(() => {
    let cancelled = false
    const key = feedKey()
    // ① 缓存命中（TTL 内）→ 直接使用，不重新聚合搜索
    try {
      const raw = localStorage.getItem(key)
      if (raw) {
        const c = JSON.parse(raw)
        if (c && c.feed && c.ts && Date.now() - c.ts < FEED_TTL) {
          setFeed(c.feed)
          setLoading(false)
          setError('')
          return
        }
      }
    } catch {
      /* 缓存损坏忽略，走重新拉取 */
    }
    // ② 无缓存 / 过期 / 手动刷新 → 重新聚合
    setLoading(true)
    setError('')
    getHomeFeed(data.settings.resourceSites, {
      metaEnabled: data.settings.metaEnabled,
      metaSource: data.settings.metaSource || ''
    })
      .then((f) => {
        if (cancelled) return
        setFeed(f)
        setLoading(false)
        try {
          localStorage.setItem(key, JSON.stringify({ ts: Date.now(), feed: f }))
        } catch {
          /* storage 满忽略 */
        }
      })
      .catch((e) => {
        if (cancelled) return
        setError(String(e?.message || e))
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [
    data.settings.resourceSites,
    data.settings.metaEnabled,
    data.settings.metaSource,
    refreshTick
  ])

  const refreshFeed = () => {
    try {
      localStorage.removeItem(feedKey())
    } catch {
      /* noop */
    }
    setRefreshTick((t) => t + 1)
  }

  const allItems = useMemo<SearchResult[]>(
    () => (feed ? (Object.values(feed.byCategory).flat() as SearchResult[]) : []),
    [feed]
  )
  const recommend = useMemo(
    () => buildRecommendations(allItems, { seed: recommendSeed, history: data.history, limit: 12 }),
    [allItems, recommendSeed, data.history]
  )
  const recent = useMemo(() => recentUpdated(allItems, 12), [allItems])

  // 主推：优先评分榜首，其次推荐首位
  const hero: SearchResult | null =
    feed && feed.ranking.length ? feed.ranking[0] : recommend[0] || null

  const catItems: SearchResult[] =
    feed && tab !== '推荐' ? feed.byCategory[tab] || [] : []

  const hasContent =
    !!feed &&
    (HOME_CATEGORIES.some((c) => (feed.byCategory[c] || []).length > 0) ||
      feed.ranking.length > 0)

  return (
    <div className="home-page">
      {/* 顶部 chip Tab（推荐 + 固定分类） */}
      <div className="home-cats">
        {['推荐', ...HOME_CATEGORIES].map((c) => (
          <button
            key={c}
            className={'home-cat' + (tab === c ? ' active' : '')}
            onClick={() => setTab(c)}
          >
            {c}
            {c === '推荐' && <i className="dot" />}
          </button>
        ))}
      </div>

      {loading && <SkeletonGrid rows={3} cols={3} />}

      {!loading && error && (
        <div className="empty">
          推荐加载失败：{error}
          <br />
          <span className="hint">可到「我的 → 资源」检查各资源站可达性。</span>
        </div>
      )}

      {!loading && !error && !hasContent && (
        <div className="empty">
          暂无内容。请到「我的 → 资源」启用至少一个资源站，或手动添加自定义源。
        </div>
      )}

      {!loading && !error && feed && hasContent && (
        <>
          {tab === '推荐' ? (
            <>
              {/* 主推大图轮播 */}
              {hero && (
                <section className="hero-banner" onClick={() => onOpen(hero)}>
                  {hero.poster ? (
                    <img className="hero-bg" src={hero.poster} alt="" loading="eager" />
                  ) : (
                    <div className="hero-bg hero-placeholder" />
                  )}
                  <div className="hero-shade" />
                  <div className="hero-info">
                    <h2 className="hero-title">{hero.title}</h2>
                    <p className="hero-meta">
                      {(hero.year || '') + ' · ' + (hero.typeName || hero.category || '') + ' · ' + (hero.rating || '')}
                    </p>
                    <button className="hero-play" onClick={(e) => { e.stopPropagation(); onOpen(hero) }}>
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                        <path d="M8 5.5v13l11-6.5z" />
                      </svg>
                      立即播放
                    </button>
                  </div>
                </section>
              )}

              {/* 热播榜单（3 列网格） */}
              {feed.ranking.length > 0 && (
                <section className="feed-section">
                  <div className="feed-section-head">
                    <h3>热播榜单</h3>
                    <span className="count">综合热度 · {feed.ranking.length} 部</span>
                  </div>
                  <div className="grid">
                    {feed.ranking.slice(0, 12).map((it: SearchResult) => (
                      <Card key={it.id} item={it} onOpen={onOpen} />
                    ))}
                  </div>
                </section>
              )}

              {/* 猜你喜欢（3 列网格） */}
              {recommend.length > 0 && (
                <section className="feed-section">
                  <div className="feed-section-head">
                    <h3>猜你喜欢</h3>
                    <span className="count">根据你的观看偏好</span>
                    <button className="more-link" onClick={() => setRecommendSeed(Math.random())}>
                      换一批 ↻
                    </button>
                    <button className="more-link" onClick={refreshFeed} title="强制重新聚合推荐">
                      刷新 ⟳
                    </button>
                  </div>
                  <div className="grid">
                    {recommend.map((it: SearchResult) => (
                      <Card key={it.id} item={it} onOpen={onOpen} />
                    ))}
                  </div>
                </section>
              )}

              {/* 最近更新（横滑） */}
              {recent.length > 0 && (
                <section className="feed-section">
                  <div className="feed-section-head">
                    <h3>最近更新</h3>
                    <span className="count">最新聚合</span>
                  </div>
                  <HScroll>
                    {recent.map((it) => (
                      <MiniCard key={it.id} item={it} onOpen={onOpen} />
                    ))}
                  </HScroll>
                </section>
              )}

              {/* 高评分（横滑） */}
              {feed.topRated.length > 0 && (
                <section className="feed-section">
                  <div className="feed-section-head">
                    <h3>高评分</h3>
                    <span className="count">评分降序 · {feed.topRated.length} 部</span>
                  </div>
                  <HScroll>
                    {feed.topRated.slice(0, 12).map((it: SearchResult) => (
                      <MiniCard key={it.id} item={it} onOpen={onOpen} />
                    ))}
                  </HScroll>
                </section>
              )}
            </>
          ) : (
            <>
              {/* 分类视图：该分类 3 列网格 */}
              <section className="feed-section">
                <div className="feed-section-head">
                  <h3>{tab}</h3>
                  <span className="count">{catItems.length} 部</span>
                  <button className="more-link" onClick={() => onOpenCategory({ id: tab, name: tab })}>
                    更多 ›
                  </button>
                </div>
                <div className="grid">
                  {catItems.slice(0, 24).map((it: SearchResult) => (
                    <Card key={it.id} item={it} onOpen={onOpen} />
                  ))}
                </div>
              </section>
            </>
          )}
        </>
      )}
    </div>
  )
}
