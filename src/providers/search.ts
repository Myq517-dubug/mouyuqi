/**
 * 跨源搜索聚合（核心算法模块）。
 * 从原 providers.ts 整体迁移：aggregateSearch / AUDIO_MODES / AUDIO_LABEL / SORT_OPTIONS /
 * SearchDiag / getLastSearchDiag。
 * 仅依赖 resource（customProvider / makeResourceProvider / getResourceSites）、types。
 */

import type {
  AudioMode,
  CategorySort,
  Provider,
  SearchResult
} from '../types'
import { customProvider, makeResourceProvider, getResourceSites } from './resource'
import type { SearchDiag } from './types'

// ---------- 音频档位 / 列表页排序 常量（T01 导出，供 Player / CategoryPage 消费） ----------
export const AUDIO_MODES: AudioMode[] = ['dolby', 'spatial', 'bass', 'original']
export const AUDIO_LABEL: Record<AudioMode, string> = {
  dolby: '杜比环绕',
  spatial: '空间音频',
  bass: '低音增强',
  original: '原声'
}
export const SORT_OPTIONS: { key: CategorySort; label: string }[] = [
  { key: 'default', label: '默认' },
  { key: 'time', label: '更新时间' },
  { key: 'rating', label: '评分' },
  { key: 'hits', label: '热度' }
]

export { getResourceSites }

// 跨源搜索聚合（多 provider 并行；结果按标题去重合并来源）
// ---------- 搜索诊断（排查「资源站在线却搜不到」）----------
export type { SearchDiag }
let lastSearchDiag: SearchDiag = { sites: 0, raw: 0, parsed: 0, perSite: [] }
export function getLastSearchDiag(): SearchDiag {
  return lastSearchDiag
}

export async function aggregateSearch(q: string): Promise<SearchResult[]> {
  const resourceSites = getResourceSites()
  const providers: Provider[] = [customProvider]
  const diag: SearchDiag = { sites: 0, raw: 0, parsed: 0, perSite: [] }
  // 仅在有搜索词时查询资源站（避免首页拖慢）；每个站点独立 try，失败不影响其它源
  if (q.trim()) {
    for (const s of resourceSites) {
      if (s.enabled) {
        providers.push(makeResourceProvider(s))
        diag.sites++
      }
    }
  }
  const results = await Promise.all(
    providers.filter((p) => p.enabled).map((p) => p.search(q).catch(() => [] as SearchResult[]))
  )
  // 汇总诊断：逐站原始/解析条数
  for (const p of providers) {
    if (p !== customProvider && (p as any).__diag) {
      const d = (p as any).__diag as { name: string; raw: number; parsed: number }
      diag.raw += d.raw
      diag.parsed += d.parsed
      diag.perSite.push(d)
    }
  }
  lastSearchDiag = diag
  const flat = results.flat()
  const map = new Map<string, SearchResult>()
  for (const item of flat) {
    const key = item.id
    if (map.has(key)) {
      const prev = map.get(key)!
      prev.sources = [...(prev.sources || []), ...(item.sources || [])]
    } else {
      map.set(key, { ...item })
    }
  }
  return [...map.values()]
}
