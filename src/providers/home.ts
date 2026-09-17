/**
 * 首页推荐聚合（核心算法模块）。
 * 从原 providers.ts 整体迁移：getHomeFeed / listFromSite / buildHomeFeed /
 * HOME_CATEGORIES / recentUpdated / mergeResults / mergeById（本期为单测导出）。
 * 仅依赖 appleCms（fetchAppleCmsItems / parseAppleCms）、resource（customProvider / makeResourceProvider）、
 * meta（enrichMeta）、state（setMetaSource / getResourceSites）、lib（mapLimit）。
 */

import type {
  HomeFeed,
  ResourceSite,
  SearchResult
} from '../types'
import { fetchAppleCmsItems, parseAppleCms, classifyCategory } from './appleCms'
import { customProvider, makeResourceProvider } from './resource'
import { enrichMeta } from './meta'
import { getResourceSites, getCustomSources, setMetaSource, proxifyUrl } from './state'
import { mapLimit } from '../lib/mapLimit'
import { homeCache, homeCacheKey } from '../lib/cache'

// 首页固定分类（顺序即平铺展示顺序；「其他」兜底）
export const HOME_CATEGORIES = ['综艺', '电影', '电视剧', '动漫', '短剧', '其他'] as const

// ---------- 首页推荐（T02 / P2-1/2/3）----------
// 对每个启用站请求 ac=list（无 wd，最新列表），再按 ids 拉 ac=detail 详情（详情才含 vod_play_url），
// 用 parseAppleCms 解析并分类。首页仅聚合已启用资源站 + 自定义源。
export async function getHomeFeed(
  sites: ResourceSite[],
  opts: { metaEnabled: boolean; metaSource: string }
): Promise<HomeFeed> {
  // P1 缓存：命中且未过期（TTL 10min）直接返回，弱网/二次进入秒开
  const key = homeCacheKey(sites as { id: string; enabled: boolean }[], {
    metaEnabled: !!opts?.metaEnabled,
    metaSource: opts?.metaSource || '',
    customCount: getCustomSources().length
  })
  const hit = homeCache.get<HomeFeed>(key)
  if (hit) return hit

  const enabled = (sites || []).filter((s) => s && s.enabled)
  // v3：并发收敛 mapLimit 6（原 Promise.all 全量并发，9 站 ×2 请求易互相挤占）
  const siteResults = await mapLimit(enabled, 6, (s) =>
    listFromSite(s).catch(() => [] as SearchResult[])
  )
  const custom = await customProvider.search('')
  let flat: SearchResult[] = [...siteResults.flat(), ...custom]
  // 元数据补全（可选）：按设置开关给推荐补海报/评分/简介；enrichMeta 内部失败自动降级
  if (opts?.metaEnabled && opts.metaSource) {
    setMetaSource(opts.metaSource)
    flat = await enrichMeta(flat)
  }
  const feed = buildHomeFeed(flat)
  homeCache.set(key, feed)
  return feed
}

// 单站最新列表（首页专用，无关键词）
// 两步兜底（与 makeResourceProvider.search 一致）：列表接口不含播放地址，需按 ids 拉详情，
// 否则 parseAppleCms 会因 sources 为空过滤掉整站内容。
export async function listFromSite(site: ResourceSite): Promise<SearchResult[]> {
  const raw = (site.api || '').trim().replace(/\/+$/, '')
  const base = /provide\/vod$/i.test(raw) ? raw : raw + '/api.php/provide/vod'
  const px = proxifyUrl
  // 第 1 步：ac=list（无 wd，最新列表），拿到含 vod_id 的原始条目
  const listRes = await fetchAppleCmsItems(px(`${base}?ac=list&at=json`))
  const listItems = listRes.items
  if (!listItems.length) return []
  // 第 2 步：用 ids 拉详情（详情接口才返回 vod_play_url 播放地址；列表接口通常不带）
  const ids = (listItems as any[])
    .map((i: any) => i.vod_id)
    .filter((x: any) => x != null && x !== '')
    .join(',')
  let detailItems: any[] = []
  if (ids) {
    detailItems = (await fetchAppleCmsItems(px(`${base}?ac=detail&ids=${ids}&at=json`))).items
  }
  const items = detailItems.length ? detailItems : listItems
  return parseAppleCms({ list: items }, site.name)
}

// 纯函数：去重合并 + 分类聚合 + 排行榜 + 评分榜
export function buildHomeFeed(items: SearchResult[]): HomeFeed {
  // 按 id 合并 sources / poster / rating / category
  const map = new Map<string, SearchResult>()
  for (const it of items) {
    if (!it || !it.id) continue
    const prev = map.get(it.id)
    if (prev) {
      prev.sources = [...(prev.sources || []), ...(it.sources || [])]
      prev.poster = prev.poster || it.poster
      prev.rating = prev.rating || it.rating
      prev.category = prev.category || it.category
      prev.year = prev.year || it.year
    } else {
      map.set(it.id, { ...it })
    }
  }
  const all = [...map.values()]
  // byCategory
  const byCategory: Record<string, SearchResult[]> = {}
  for (const it of all) {
    const c = it.category || '其他'
    const arr = byCategory[c] || (byCategory[c] = [])
    arr.push(it)
  }
  // 排序：每个分类内按评分降序，无评分置尾
  for (const c of Object.keys(byCategory)) {
    byCategory[c] = byCategory[c].sort((a, b) => numRating(b) - numRating(a))
  }
  // ranking: score = rating * (1 + log(1 + 有效源数))，rating 缺失置尾
  // 全站均无 rating 时退化为源数降序（设计 §A.5 #2）
  const hasAnyRating = all.some((it) => numRating(it) >= 0)
  const ranking = [...all].sort((a, b) => {
    if (hasAnyRating) return rankScore(b) - rankScore(a)
    return (b.sources?.length || 0) - (a.sources?.length || 0)
  })
  // topRated: rating 降序，无 rating 置尾
  const topRated = [...all].sort((a, b) => numRating(b) - numRating(a))
  return { byCategory, ranking, topRated }
}

function numRating(it: SearchResult): number {
  const n = Number(it.rating)
  return isFinite(n) ? n : -1
}
function rankScore(it: SearchResult): number {
  const r = numRating(it)
  if (r < 0) return -1 // 缺失置尾
  const srcCount = (it.sources || []).length
  return r * (1 + Math.log(1 + srcCount))
}

// 无历史时回退「热门」：复用 ranking 逻辑
function rankTop(all: SearchResult[], limit: number): SearchResult[] {
  const hasAnyRating = all.some((it) => numRating(it) >= 0)
  const arr = [...all].sort((a, b) => {
    if (hasAnyRating) return rankScore(b) - rankScore(a)
    return (b.sources?.length || 0) - (a.sources?.length || 0)
  })
  return arr.slice(0, limit)
}

// 最近更新：vod_time 倒序 TopN（无值置尾）
export function recentUpdated(all: SearchResult[], limit = 12): SearchResult[] {
  return [...all].sort((a, b) => numTime(b) - numTime(a)).slice(0, limit)
}

function numTime(it: SearchResult): number {
  const t = it.time
  if (t == null) return -1
  const n = Number(t)
  if (isFinite(n)) return n < 1e12 ? n * 1000 : n
  const ts = new Date(String(t).replace(/-/g, '/')).getTime()
  return isFinite(ts) ? ts : -1
}

// 按 id 合并去重（跨站同名内容合并 sources 等字段；不修改入参）
// 原为内部函数，本期为单测显式导出。
export function mergeById(items: SearchResult[]): SearchResult[] {
  const map = new Map<string, SearchResult>()
  for (const it of items) {
    if (!it || !it.id) continue
    const prev = map.get(it.id)
    if (prev) {
      prev.sources = [...(prev.sources || []), ...(it.sources || [])]
      prev.poster = prev.poster || it.poster
      prev.rating = prev.rating || it.rating
      prev.year = prev.year || it.year
      prev.category = prev.category || it.category
      prev.time = prev.time || it.time
      prev.hits = prev.hits ?? it.hits
      prev.typeName = prev.typeName || it.typeName
    } else {
      map.set(it.id, { ...it })
    }
  }
  return [...map.values()]
}

// 按预估值降序去重合并（跨批次/跨站合并 sources 等字段；幂等：sources 按 url 去重，可重复调用）
export function mergeResults(items: SearchResult[]): SearchResult[] {
  const map = new Map<string, SearchResult>()
  for (const it of items) {
    if (!it || !it.id) continue
    const prev = map.get(it.id)
    if (prev) {
      const seen = new Set((prev.sources || []).map((s) => s.url))
      const merged = [...(prev.sources || [])]
      for (const s of it.sources || []) {
        if (!seen.has(s.url)) {
          merged.push(s)
          seen.add(s.url)
        }
      }
      prev.sources = merged
      prev.poster = prev.poster || it.poster
      prev.rating = prev.rating || it.rating
      prev.year = prev.year || it.year
      prev.category = prev.category || it.category
      prev.time = prev.time || it.time
      prev.hits = prev.hits ?? it.hits
      prev.typeName = prev.typeName || it.typeName
    } else {
      map.set(it.id, { ...it, sources: [...(it.sources || [])] })
    }
  }
  return [...map.values()]
}

// 兼容分类兜底（部分页面仍按标题/类型归类，确保 category 字段存在）。
export { classifyCategory }
export { getResourceSites }
