import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SearchResult, ResourceSite, CategoryFilters, CategorySort } from '../types'
import {
  fetchCategoryPageAll,
  mergeResults,
  applyFilters,
  applySort,
  SORT_OPTIONS
} from '../providers'
import { Card } from '../components'

// 分类列表页（T03 / P1）：顶栏 → 筛选条 → 排序条 → 网格 → 加载更多
// v3（Bug3）数据策略重写：
//   · 首屏只拉每站 pg=1（fetchCategoryPageAll，mapLimit 6 并发），10s 兜底超时；
//   · 每站结果一就绪就渐进合并渲染（onBatch），超时也保留已到数据，不再「0 部 + 加载超时」；
//   · 加载更多按页增量拉 pg=2..3（上限 3 页/站），5s 兜底；
//   · 重试按钮 = 重置后重发；已显示部分数据时超时只出软提示，不弹错误态。
// 筛选/排序为页面一次性会话态（每次 mount 重置，返回首页不残留）。
const PER_PAGE = 30
// v3（Bug3）：每站拉取页数上限收敛为 3（原 5 页 ×9 站 ×2 请求在超时预算内跑不完）
const MAX_CAT_PAGES = 3
const QUALITY_OPTIONS = ['1080P', '720P', '480P', '360P', '未知']

export function CategoryPage({
  category,
  sites,
  onOpen,
  onBack,
  onToast
}: {
  category: string
  sites: ResourceSite[]
  onOpen: (i: SearchResult) => void
  onBack: () => void
  onToast: (t: string) => void
}) {
  // 原始分类池（未筛选），用于派生筛选项 + 本地即时筛选排序
  const [pool, setPool] = useState<SearchResult[]>([])
  const [pagesFetched, setPagesFetched] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  // v3：软超时提示（已有部分数据时，不进错误态只提示）
  const [partial, setPartial] = useState('')
  const [filters, setFilters] = useState<CategoryFilters>({})
  const [sort, setSort] = useState<CategorySort>('default')
  const [visibleCount, setVisibleCount] = useState(PER_PAGE)
  const reqRef = useRef(0)
  const poolRef = useRef<SearchResult[]>([])
  const sentinelRef = useRef<HTMLDivElement>(null)

  const setPoolBoth = useCallback((next: SearchResult[]) => {
    poolRef.current = next
    setPool(next)
  }, [])

  // 筛选项（从已聚合池派生，稳定）
  const yearOptions = useMemo(() => {
    const s = new Set<string>()
    for (const it of pool) if (it.year) s.add(it.year)
    return [...s].sort((a, b) => Number(b) - Number(a))
  }, [pool])
  const typeOptions = useMemo(() => {
    const s = new Set<string>()
    for (const it of pool) if (it.typeName) s.add(it.typeName)
    return [...s]
  }, [pool])
  const providerOptions = useMemo(() => {
    const s = new Set<string>()
    for (const it of pool) if (it.provider) s.add(it.provider)
    return [...s]
  }, [pool])

  // 本地即时筛选 + 排序（≤500ms，无需重新拉网络）
  const filtered = useMemo(() => applySort(applyFilters(pool, filters), sort), [pool, filters, sort])
  const visible = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount])
  const hasMore = visibleCount < filtered.length || pagesFetched < MAX_CAT_PAGES

  // v3：增量加载单页（reset=true 重置全部状态，供首屏/重试用）
  const loadPage = useCallback(
    async (page: number, opts?: { reset?: boolean }) => {
      const my = ++reqRef.current
      if (opts?.reset) {
        poolRef.current = []
        setPool([])
        setPagesFetched(0)
        setVisibleCount(PER_PAGE)
        setError('')
        setPartial('')
      }
      const firstScreen = poolRef.current.length === 0
      if (firstScreen) setLoading(true)
      else setLoadingMore(true)
      // 首屏（重置拉 pg=1）10s 兜底；追加页 5s 兜底（onBatch 渐进合并，超时不丢已到数据）
      const timeoutMs = opts?.reset || firstScreen ? 10000 : 5000
      let chaining = false
      try {
        const got = await Promise.race<SearchResult[] | null>([
          fetchCategoryPageAll(sites, category, page, (batch) => {
            if (my !== reqRef.current) return
            setPoolBoth(mergeResults([...poolRef.current, ...batch]))
          }),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs))
        ])
        if (my !== reqRef.current) return
        if (got) {
          setPoolBoth(mergeResults([...poolRef.current, ...got]))
          setPagesFetched(page)
          setPartial('') // 追加成功后清除此前的软超时提示
          if (!opts?.reset && page > 1) setVisibleCount((c) => c + PER_PAGE)
          // 单页不足一屏时自动续拉下一页（有新内容才续，避免空转）
          if (got.length > 0 && got.length < PER_PAGE && page < MAX_CAT_PAGES) {
            chaining = true
            void loadPage(page + 1)
          }
        } else {
          // 超时：已有数据 → 软提示；无数据 → 错误态 + 重试
          if (poolRef.current.length > 0) {
            setPartial('部分资源加载超时，已显示可用内容；可点击「加载更多」重试')
          } else {
            setError('加载超时，请稍后重试')
          }
        }
      } catch (e: any) {
        if (my !== reqRef.current) return
        if (poolRef.current.length > 0) {
          setPartial('部分资源加载失败：' + (e?.message || e))
        } else {
          setError('加载失败：' + (e?.message || e))
        }
      } finally {
        if (my === reqRef.current && !chaining) {
          setLoading(false)
          setLoadingMore(false)
        }
      }
    },
    [category, sites, setPoolBoth]
  )

  // 挂载 / 切分类时重置并拉取首屏（筛选排序为会话态，变化不重新拉网络）
  useEffect(() => {
    loadPage(1, { reset: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category])

  // 触底自动加载（IntersectionObserver）
  const loadMore = () => {
    if (loading || loadingMore) return
    if (visibleCount < filtered.length) {
      setVisibleCount((c) => c + PER_PAGE)
    } else if (pagesFetched < MAX_CAT_PAGES) {
      loadPage(pagesFetched + 1)
    }
  }
  const loadMoreRef = useRef(loadMore)
  loadMoreRef.current = loadMore
  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) loadMoreRef.current()
      },
      { rootMargin: '240px' }
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  return (
    <>
      <div className="page-head cat-head">
        <button className="btn cat-back" onClick={onBack}>← 返回首页</button>
        <h2>{category}</h2>
        <span className="count">
          {filters.year || filters.typeName || filters.provider || filters.quality
            ? `匹配 ${filtered.length} / ${pool.length} 部`
            : `已聚合 ${filtered.length} 部`}
        </span>
      </div>
      <div className="hint" style={{ marginTop: -8, marginBottom: 10 }}>
        分类列表为跨资源站最新聚合（最多 {MAX_CAT_PAGES} 页/站），总数非权威全量；筛选与排序即时本地生效。
      </div>

      {/* 细分类筛选条 */}
      <div className="cat-filterbar">
        <span className="cat-filter-label">筛选</span>
        <select
          value={filters.year || ''}
          onChange={(e) => setFilters((f) => ({ ...f, year: e.target.value || undefined }))}
        >
          <option value="">年份 全部</option>
          {yearOptions.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
        <select
          value={filters.typeName || ''}
          onChange={(e) => setFilters((f) => ({ ...f, typeName: e.target.value || undefined }))}
        >
          <option value="">类型 全部</option>
          {typeOptions.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <select
          value={filters.provider || ''}
          onChange={(e) => setFilters((f) => ({ ...f, provider: e.target.value || undefined }))}
        >
          <option value="">来源 全部</option>
          {providerOptions.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
        <select
          value={filters.quality || ''}
          onChange={(e) => setFilters((f) => ({ ...f, quality: e.target.value || undefined }))}
        >
          <option value="">清晰度 全部</option>
          {QUALITY_OPTIONS.map((q) => (
            <option key={q} value={q}>{q}</option>
          ))}
        </select>
        {(filters.year || filters.typeName || filters.provider || filters.quality) && (
          <button className="btn sm" onClick={() => setFilters({})}>清空全部 ✕</button>
        )}
      </div>

      {/* 排序条 */}
      <div className="cat-sortbar">
        <span className="cat-sort-label">排序</span>
        {SORT_OPTIONS.map((o) => (
          <button
            key={o.key}
            className={'sort-chip' + (sort === o.key ? ' active' : '')}
            onClick={() => setSort(o.key)}
          >
            {o.label}
          </button>
        ))}
      </div>

      {/* 加载中骨架屏（3 列 × 2 行 shimmer） */}
      {loading && (
        <div className="cat-grid">
          {Array.from({ length: 6 }).map((_v, i) => (
            <div key={i} className="sk-card">
              <div className="sk-poster" />
              <div className="sk-line" />
            </div>
          ))}
        </div>
      )}

      {/* 软超时提示（已有部分数据时不进错误态） */}
      {!loading && partial && (
        <div className="cat-partial" role="status">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
            <path d="M12 7v6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <circle cx="12" cy="16.5" r="1.3" fill="currentColor" />
          </svg>
          <span>{partial}</span>
        </div>
      )}

      {/* 错误态（带插画图标 + 重试按钮重发请求） */}
      {!loading && error && visible.length === 0 && (
        <div className="empty cat-state">
          <svg width="44" height="44" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M12 3 2.5 20h19L12 3Z"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinejoin="round"
            />
            <path d="M12 9.5v5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            <circle cx="12" cy="17.2" r="1.1" fill="currentColor" />
          </svg>
          <div className="cat-state-text">{error}</div>
          <div style={{ marginTop: 12 }}>
            <button className="btn cat-retry" onClick={() => loadPage(1, { reset: true })}>
              重试
            </button>
          </div>
        </div>
      )}

      {/* 空态 */}
      {!loading && !error && visible.length === 0 && (
        <div className="empty cat-state">
          <svg width="44" height="44" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <rect x="3" y="5" width="18" height="14" rx="2.5" stroke="currentColor" strokeWidth="1.6" />
            <path d="M3 9h18" stroke="currentColor" strokeWidth="1.6" />
            <path d="m10.2 12.4 4.4 2.4-4.4 2.4v-4.8Z" fill="currentColor" />
          </svg>
          <div className="cat-state-text">没有找到符合条件的影片</div>
          {(filters.year || filters.typeName || filters.provider || filters.quality) && (
            <div style={{ marginTop: 12 }}>
              <button className="btn sm" onClick={() => setFilters({})}>清空筛选条件</button>
            </div>
          )}
        </div>
      )}

      {/* 内容网格 */}
      {visible.length > 0 && (
        <div className="cat-grid">
          {visible.map((it) => (
            <Card key={it.id} item={it} onOpen={onOpen} />
          ))}
        </div>
      )}

      {/* 加载更多 / 没有更多了 */}
      {!loading && !error && visible.length > 0 && (
        <div className="cat-loadmore">
          {hasMore ? (
            <button className="btn cat-loadmore-btn" onClick={loadMore} disabled={loadingMore}>
              {loadingMore ? (
                <>
                  <span className="spinner sm" aria-hidden="true" />
                  加载中…
                </>
              ) : (
                '加载更多 ⭣'
              )}
            </button>
          ) : (
            <span className="hint">没有更多了</span>
          )}
        </div>
      )}

      {/* 触底自动加载哨兵 */}
      <div ref={sentinelRef} style={{ height: 1 }} />
    </>
  )
}
