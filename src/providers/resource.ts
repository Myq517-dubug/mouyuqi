/**
 * 资源站与自定义源（核心算法模块）。
 * 从原 providers.ts 整体迁移：customProvider / DEFAULT_RESOURCE_SITES / checkResourceSite /
 * checkAllResourceSites / probeResourceSite / makeResourceProvider（内部）。
 * 仅依赖 appleCms（capFetchText / parseAppleCms / fetchAppleCmsItems / parseAppleCmsXml）、
 * state（setters 与 getResourceSites / proxifyUrl）、types。
 */

import type { Provider, ResourceSite, SearchResult, VideoSource } from '../types'
import { setCustomSources, proxifyUrl } from './state'
import {
  capFetchText,
  fetchAppleCmsItems,
  parseAppleCms,
  parseAppleCmsXml
} from './appleCms'
import { mapLimit } from '../lib/mapLimit'
import type { SiteCheck, ProbeResult } from './types'

export type { SiteCheck, ProbeResult }
export { setCustomSources, getResourceSites }

// 自定义源 provider：数据由 App 注入（来自设置中的"我的自定义源"）
export const customProvider: Provider = {
  id: 'custom',
  name: '我的自定义源',
  enabled: true,
  async search(q: string) {
    const kw = q.trim().toLowerCase()
    return getResourceSitesCustom(kw)
  },
  async getSources(item: SearchResult): Promise<VideoSource[]> {
    return item.sources || []
  }
}

// customProvider.search 依赖注入的自定义源列表（getCustomSources），此处复用 state 的 getCustomSources。
import { getCustomSources, getResourceSites } from './state'
function getResourceSitesCustom(kw: string): SearchResult[] {
  const customList = getCustomSources()
  return customList
    .filter((i) => (kw ? i.title.toLowerCase().includes(kw) : true))
    .map((i) => ({ ...i, provider: 'custom' }))
}

// 默认公开示例资源站（可删可改；请仅添加你有权使用的来源）
// 取自社区每日健康检测（2026-08）标注可用的苹果CMS 资源站；端点可能变动，搜不到时在「资源中心」替换即可
export const DEFAULT_RESOURCE_SITES: ResourceSite[] = [
  { id: 'res-jszy', name: '极速资源', api: 'https://jszyapi.com/api.php/provide/vod', enabled: true },
  { id: 'res-zuid', name: '最大资源', api: 'https://api.zuidapi.com/api.php/provide/vod', enabled: true },
  { id: 'res-guangsu', name: '光速资源', api: 'https://api.guangsuapi.com/api.php/provide/vod', enabled: true },
  { id: 'res-yhzy', name: '樱花资源', api: 'https://m3u8.apiyhzy.com/api.php/provide/vod', enabled: true },
  { id: 'res-maoyan', name: '猫眼资源', api: 'https://api.maoyanapi.top/api.php/provide/vod', enabled: true },
  { id: 'res-hongniu', name: '红牛资源', api: 'https://www.hongniuzy2.com/api.php/provide/vod', enabled: true },
  { id: 'res-baofeng', name: '暴风资源', api: 'https://bfzyapi.com/api.php/provide/vod', enabled: true },
  { id: 'res-wolong', name: '卧龙资源', api: 'https://wolongzyw.com/api.php/provide/vod', enabled: true },
  { id: 'res-lzi', name: '量子资源', api: 'https://cj.lziapi.com/api.php/provide/vod', enabled: true }
]

// v1 既有导出：聚合层默认 provider 列表（仅含自定义源；资源站在聚合时按需附加）。
export const allProviders: Provider[] = [customProvider]

// ---------- 资源站健康检查 ----------
// 探活单个资源站：用通用试探词请求，判断可达性与返回结构是否正常
// 同样走「列表→详情」两步，使 parsed（可播条数）真实反映能否解析出播放地址
export async function checkResourceSite(site: ResourceSite): Promise<SiteCheck> {
  if (!site.enabled) {
    return { id: site.id, name: site.name, ok: false, alive: false, count: 0, parsed: 0, ms: 0, error: '已禁用' }
  }
  const raw = site.api.trim().replace(/\/+$/, '')
  const base = /provide\/vod$/i.test(raw) ? raw : raw + '/api.php/provide/vod'
  const px = proxifyUrl
  const start = performance.now()
  // 第 1 步：列表搜索试探词，拿到匹配条目的 vod_id
  const listRes = await fetchAppleCmsItems(px(`${base}?ac=list&wd=test&at=json`))
  const list = listRes.items
  const count = Array.isArray(list) ? list.length : 0
  let parsed = 0
  if (count) {
    // 第 2 步：用 ids 拉详情，详情接口才含 vod_play_url 播放地址
    const ids = (list as any[])
      .map((i: any) => i.vod_id)
      .filter((x: any) => x != null && x !== '')
      .join(',')
    let detailList: any[] = []
    if (ids) {
      detailList = (await fetchAppleCmsItems(px(`${base}?ac=detail&ids=${ids}&at=json`))).items
    }
    const items = detailList.length ? detailList : list
    parsed = parseAppleCms({ list: items }, site.name).length
  }
  const ms = Math.round(performance.now() - start)
  // ok 以「是否真解析出可播条目」为准：可达但解析为 0，说明格式不兼容（在线但搜不到）
  return {
    id: site.id,
    name: site.name,
    ok: parsed > 0,
    alive: count > 0 || parsed > 0,
    count,
    parsed,
    ms
  }
}

// 并发探活所有资源站（限制并发，避免瞬间打爆）
export async function checkAllResourceSites(sites: ResourceSite[]): Promise<SiteCheck[]> {
  return mapLimit(sites, 4, (s) => checkResourceSite(s))
}

// 抓取某个资源站对试探词的原始返回（用于排查「在线·解析0」的格式问题）
export async function probeResourceSite(site: ResourceSite): Promise<ProbeResult> {
  const raw = site.api.trim().replace(/\/+$/, '')
  const base = /provide\/vod$/i.test(raw) ? raw : raw + '/api.php/provide/vod'
  const api = `${base}?ac=list&wd=%E7%94%B5%E5%BD%B1&at=json`
  const url = proxifyUrl(api)
  const start = performance.now()
  try {
    const r = await capFetchText(url, { headers: { accept: 'application/json' }, timeoutMs: 12000 })
    const text = r.text
    let j: any
    try {
      j = JSON.parse(text)
    } catch {
      j = parseAppleCmsXml(text, site.name)
    }
    const list = j?.list || j?.data?.list || []
    const sample = Array.isArray(list) && list[0] ? list[0] : undefined
    const parsed = Array.isArray(list) ? parseAppleCms({ list }, site.name).length : 0
    return {
      ok: r.ok,
      httpStatus: r.status || undefined,
      text: text.length > 4000 ? text.slice(0, 4000) + '\n...(truncated)' : text,
      parsed,
      sample,
      ms: Math.round(performance.now() - start)
    }
  } catch (e: any) {
    return {
      ok: false,
      text: '',
      parsed: 0,
      error: String(e?.message || e),
      ms: Math.round(performance.now() - start)
    }
  }
}

// 单站 provider 工厂：列表→详情两步拉取并解析为可播源（与 makeResourceProvider 同源）。
export function makeResourceProvider(site: ResourceSite): Provider {
  const provider: Provider = {
    id: 'res-' + site.id,
    name: site.name,
    enabled: site.enabled,
    async search(q: string): Promise<SearchResult[]> {
      const kw = q.trim()
      if (!kw) return []
      // 兼容两种写法：用户粘贴「站根」(https://x.com) 或「完整接口」(…/api.php/provide/vod/)
      const raw = site.api.trim().replace(/\/+$/, '')
      const base = /provide\/vod$/i.test(raw) ? raw : raw + '/api.php/provide/vod'
      const px = proxifyUrl
      // 第 1 步：列表搜索，拿到匹配条目（含 vod_id，但【不含】播放地址）
      const listRes = await fetchAppleCmsItems(px(`${base}?ac=list&wd=${encodeURIComponent(kw)}&at=json`))
      const listItems = listRes.items
      const rawCount = Array.isArray(listItems) ? listItems.length : 0
      if (!rawCount) {
        // 记录每站原始/解析条数，供搜索诊断展示
        ;(provider as any).__diag = { name: site.name, raw: 0, parsed: 0 }
        return []
      }
      // 第 2 步：用 ids 拉详情，详情接口才返回 vod_play_url 播放地址（列表接口不带）
      const ids = (listItems as any[])
        .map((i: any) => i.vod_id)
        .filter((x: any) => x != null && x !== '')
        .join(',')
      let detailItems: any[] = []
      if (ids) {
        detailItems = (await fetchAppleCmsItems(px(`${base}?ac=detail&ids=${ids}&at=json`))).items
      }
      const items = detailItems.length ? detailItems : listItems
      const parsed = parseAppleCms({ list: items }, site.name)
      // 记录每站原始/解析条数，供搜索诊断展示
      ;(provider as any).__diag = { name: site.name, raw: rawCount, parsed: parsed.length }
      return parsed
    },
    async getSources(item: SearchResult): Promise<VideoSource[]> {
      return item.sources || []
    }
  }
  return provider
}
