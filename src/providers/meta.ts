/**
 * 元数据补全（可选功能模块）。
 * 从原 providers.ts 整体迁移：fetchMeta / enrichMeta / postProcess。
 * 仅依赖 appleCms（capFetchText）、state（metaSource）、lib（mapLimit）。
 */

import type { Meta, SearchResult } from '../types'
import { getMetaSource } from './state'
import { capFetchText } from './appleCms'
import { mapLimit } from '../lib/mapLimit'

// 示例豆瓣元数据镜像（可选；端点可能变动，请在设置中替换为你可用的来源）
export const DEFAULT_META_SOURCE = 'https://api.douban.tf/movie?q={title}'

// ---------- 元数据补全（可选）----------
export async function fetchMeta(title: string): Promise<Meta | null> {
  const metaSource = getMetaSource()
  if (!metaSource) return null
  const url = metaSource.replace(/\{title\}|\{q\}/g, encodeURIComponent(title))
  try {
    const r = await capFetchText(url, { timeoutMs: 5000 })
    if (!r.ok) return null
    const j = JSON.parse(r.text)
    const arr: any = Array.isArray(j) ? j : j?.data?.list || j?.list || j?.data || j
    const item: any = Array.isArray(arr) ? arr[0] : arr
    if (!item) return null
    const pick = (...keys: string[]) =>
      keys.map((k) => item[k]).find((v) => typeof v === 'string' && v.length) as string | undefined
    const poster = pick('poster', 'cover', 'vod_pic', 'image')
    const year = pick('year', 'vod_year', 'y')
    const rating = pick('rating', 'rate', 'score', 'douban_score', 'rate_val')
    const summary = pick('summary', 'description', 'plot', 'vod_blurb', 'intro')
    return {
      poster: poster || undefined,
      year: year || undefined,
      rating: rating || undefined,
      summary: summary || undefined
    }
  } catch {
    return null
  }
}

// 批量元数据补全：仅在缺字段时补全，返回新数组（不修改入参）
export async function enrichMeta(items: SearchResult[]): Promise<SearchResult[]> {
  const metaSource = getMetaSource()
  if (!metaSource) return items
  return mapLimit(items, 4, async (it) => {
    const m = await fetchMeta(it.title)
    if (!m) return it
    return {
      ...it,
      poster: it.poster || m.poster,
      year: it.year || m.year,
      rating: it.rating || m.rating,
      description: it.description || m.summary
    }
  })
}

// 搜索结果后处理：按设置依次测速 + 元数据补全，返回可渲染的新数组
export async function postProcess(
  items: SearchResult[],
  opts: { speedTest: boolean; metaEnabled: boolean }
): Promise<SearchResult[]> {
  let out = items
  if (opts.speedTest) {
    const { speedTestAll } = await import('./speed')
    out = await speedTestAll(out)
  }
  if (opts.metaEnabled) out = await enrichMeta(out)
  return out
}
