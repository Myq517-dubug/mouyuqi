/**
 * 分类列表页 / 首页深化（核心算法模块）。
 * 从原 providers.ts 整体迁移：fetchCategoryPage / fetchCategoryPool / fetchCategoryPageAll /
 * getCategoryList / applyFilters / applySort / classifyCategory / mapCategoryText。
 * 仅依赖 appleCms（fetchAppleCmsItems / parseAppleCms）、state（proxifyUrl）、lib（mapLimit）。
 */

import type {
  CategoryFilters,
  CategoryListQuery,
  CategoryListResult,
  CategorySort,
  ResourceSite,
  SearchResult
} from '../types'
import { fetchAppleCmsItems, parseAppleCms, classifyCategory, mapCategoryText } from './appleCms'
import { proxifyUrl } from './state'
import { mergeResults } from './home'
import { mapLimit } from '../lib/mapLimit'
import { categoryCache, categoryCacheKey } from '../lib/cache'

// classifyCategory / mapCategoryText 在 v1 为内部函数，本期随分类页需求显式对外（superset 导出）。
export { classifyCategory, mapCategoryText }

// 拉取单站单页最新列表（ac=list 无 wd）+ 详情（ac=detail），返回已解析可播条目
export async function fetchCategoryPage(
  site: ResourceSite,
  page: number
): Promise<SearchResult[]> {
  const raw = (site.api || '').trim().replace(/\/+$/, '')
  const base = /provide\/vod$/i.test(raw) ? raw : raw + '/api.php/provide/vod'
  const px = proxifyUrl
  const listRes = await fetchAppleCmsItems(px(`${base}?ac=list&pg=${page}&at=json`), 9000)
  const listItems = listRes.items
  if (!listItems.length) return []
  const ids = (listItems as any[])
    .map((i: any) => i.vod_id)
    .filter((x: any) => x != null && x !== '')
    .join(',')
  let detailItems: any[] = []
  if (ids) {
    detailItems = (await fetchAppleCmsItems(px(`${base}?ac=detail&ids=${ids}&at=json`), 9000)).items
  }
  const items = detailItems.length ? detailItems : listItems
  return parseAppleCms({ list: items }, site.name)
}

// 聚合各启用站最新列表（1..maxPages，上限 5 页/站），合并去重后按固定分类过滤
export async function fetchCategoryPool(
  sites: ResourceSite[],
  category: string,
  maxPages = 3
): Promise<SearchResult[]> {
  const enabled = (sites || []).filter((s) => s && s.enabled)
  const pages = Array.from({ length: Math.max(1, Math.min(maxPages, 5)) }, (_v, i) => i + 1)
  // v3：并发 4→6（9 站两波收敛，减少连接排队）
  const perSite = await mapLimit(enabled, 6, async (site) => {
    const items: SearchResult[] = []
    for (const pg of pages) {
      items.push(...(await fetchCategoryPage(site, pg).catch(() => [] as SearchResult[])))
    }
    return items
  })
  const merged = mergeResults(perSite.flat())
  return merged.filter((it) => (it.category || '其他') === category)
}

// v3（Bug3）：分类页增量拉取——只拉单页（pg=page）跨站聚合，mapLimit 6 并发；
// onBatch：每站结果一就绪就回调（先到先渲染），配合页面级超时实现「部分数据也展示」。
export async function fetchCategoryPageAll(
  sites: ResourceSite[],
  category: string,
  page: number,
  onBatch?: (items: SearchResult[]) => void
): Promise<SearchResult[]> {
  // P1 缓存：按「启用站点指纹 + 分类 + 页号」命中则直接返回（TTL 10min）
  const key = categoryCacheKey(sites as { id: string; enabled: boolean }[], category, page)
  const cached = categoryCache.get<SearchResult[]>(key)
  if (cached) {
    if (onBatch) {
      const filtered = cached.filter((it) => (it.category || '其他') === category)
      if (filtered.length) onBatch(filtered)
    }
    return cached
  }

  const enabled = (sites || []).filter((s) => s && s.enabled)
  const perSite = await mapLimit(enabled, 6, async (site) => {
    const items = await fetchCategoryPage(site, page).catch(() => [] as SearchResult[])
    if (onBatch) {
      const filtered = items.filter((it) => (it.category || '其他') === category)
      if (filtered.length) onBatch(filtered)
    }
    return items
  })
  const result = mergeResults(perSite.flat()).filter((it) => (it.category || '其他') === category)
  categoryCache.set(key, result)
  return result
}

// 分类列表页查询：聚合 → 本地分类过滤 → applyFilters/applySort 兜底 → 分页切片
export async function getCategoryList(
  sites: ResourceSite[],
  query: CategoryListQuery
): Promise<CategoryListResult> {
  const { category, page = 1, perPage = 30, filters, sort } = query
  const pool = await fetchCategoryPool(sites, category, Math.min(3 * page, 5))
  const filtered = applyFilters(pool, filters)
  const sorted = applySort(filtered, sort)
  const start = (page - 1) * perPage
  return {
    items: sorted.slice(start, start + perPage),
    page,
    hasMore: start + perPage < sorted.length || 3 * page < 5,
    total: sorted.length
  }
}

// 本地筛选兜底（任一条件叠加；quality 由 sources 最大 height 派生）
export function applyFilters(
  items: SearchResult[],
  filters?: CategoryFilters
): SearchResult[] {
  if (!filters) return items
  return items.filter((it) => {
    if (filters.year && it.year !== filters.year) return false
    if (filters.typeName && (it.typeName || '') !== filters.typeName) return false
    if (filters.provider && it.provider !== filters.provider) return false
    if (filters.quality && itemMaxQuality(it) !== filters.quality) return false
    return true
  })
}

// 本地排序兜底：default 保持聚合顺序；time/hits 倒序（缺失置尾）；rating 复用 numRating
export function applySort(items: SearchResult[], sort?: CategorySort): SearchResult[] {
  const arr = [...items]
  if (sort === 'time') {
    arr.sort((a, b) => numTime(b) - numTime(a))
  } else if (sort === 'rating') {
    arr.sort((a, b) => numRating(b) - numRating(a))
  } else if (sort === 'hits') {
    arr.sort((a, b) => (b.hits ?? -1) - (a.hits ?? -1))
  }
  return arr
}

function itemMaxQuality(item: SearchResult): string {
  const h = Math.max(0, ...(item.sources || []).map((s) => s.height || 0))
  if (h >= 2160) return '2160P'
  if (h >= 1080) return '1080P'
  if (h >= 720) return '720P'
  if (h >= 480) return '480P'
  if (h >= 360) return '360P'
  return '未知'
}

function numRating(it: SearchResult): number {
  const n = Number(it.rating)
  return isFinite(n) ? n : -1
}

// vod_time → 可比较时间戳：兼容数字（秒/毫秒）与日期字符串；缺失 -1 置尾
function numTime(it: SearchResult): number {
  const t = it.time
  if (t == null) return -1
  const n = Number(t)
  if (isFinite(n)) return n < 1e12 ? n * 1000 : n
  const ts = new Date(String(t).replace(/-/g, '/')).getTime()
  return isFinite(ts) ? ts : -1
}
