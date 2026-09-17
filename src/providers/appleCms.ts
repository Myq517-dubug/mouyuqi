/**
 * 苹果CMS 解析与媒体地址解析（核心算法模块）。
 * 从原 providers.ts 整体迁移，算法逻辑一字不改：capFetchText / fetchAppleCmsItems /
 * parseAppleCms / parseAppleCmsXml / resolveMediaUrl / detectResolvedMedia。
 *
 * 铁律：不重构聚合核心算法，仅做文件级搬家 + 接口澄清。
 */

import type { SearchResult, VideoSource } from '../types'
import { isCapacitor } from '../platform'
import { getProxyBase, getProxyEnabled, proxifyUrl } from './state'
import type { ResolvedMedia } from './types'

export type { ResolvedMedia }

// ---------- Android 原生 HTTP（绕过 WebView CORS）----------
// Capacitor 核心库内置 CapacitorHttp 插件（com.getcapacitor.plugin.CapacitorHttp），
// 走安卓原生网络栈，不受 https://localhost scheme 的 CORS 限制（资源站 API 普遍无 CORS 头）。
// 非 Capacitor 环境或原生调用失败时回退 window.fetch（双保险）。
export async function capFetchText(
  url: string,
  opts: { headers?: Record<string, string>; timeoutMs?: number } = {}
): Promise<{ ok: boolean; status: number; text: string; contentType: string }> {
  const { headers = {}, timeoutMs = 9000 } = opts
  if (isCapacitor()) {
    try {
      const http = (window as any)?.Capacitor?.Plugins?.CapacitorHttp
      if (http?.get) {
        const res = await http.get({
          url,
          headers,
          responseType: 'text',
          connectTimeout: timeoutMs,
          readTimeout: timeoutMs
        })
        const status = Number(res?.status) || 0
        let text = res?.data
        if (typeof text !== 'string') text = text != null ? JSON.stringify(text) : ''
        const h = res?.headers || {}
        const contentType = String(h['content-type'] || h['Content-Type'] || '').toLowerCase()
        return { ok: status >= 200 && status < 300, status, text, contentType }
      }
    } catch {
      // 原生 HTTP 失败 → 降级 fetch
    }
  }
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const r = await fetch(url, { headers, signal: ctrl.signal })
    const text = await r.text()
    return {
      ok: r.ok,
      status: r.status,
      text,
      contentType: (r.headers.get('content-type') || '').toLowerCase()
    }
  } catch {
    return { ok: false, status: 0, text: '', contentType: '' }
  } finally {
    clearTimeout(timer)
  }
}

// ---------- 苹果CMS 接口请求助手 ----------
// 统一处理：代理转发 + 超时 + 先读文本再 JSON.parse（避免 r.json() 消费响应体后 XML 兜底读不到）
// 返回原始 item 数组（j.list 或 j.data.list），失败返回空
export async function fetchAppleCmsItems(
  apiUrl: string,
  timeoutMs = 9000
): Promise<{ items: any[]; text: string; ok: boolean }> {
  // Android 上走 CapacitorHttp 原生请求（绕过 CORS）；桌面/Electron 走 fetch（必要时挂代理）
  const r = await capFetchText(apiUrl, { headers: { accept: 'application/json' }, timeoutMs })
  if (!r.ok) return { items: [], text: '', ok: false }
  const text = r.text
  let j: any
  try {
    j = JSON.parse(text)
  } catch {
    j = parseAppleCmsXml(text, '')
  }
  return { items: j?.list || j?.data?.list || [], text, ok: true }
}

// ---------- 播放地址解析（解决「伪 mp4」播放页源打不开）----------
// 部分苹果CMS 线路返回的是无扩展名的播放页 URL（如 https://vv.jisuzyv.com/play/bmZYL5pd），
// 页面内嵌真实媒体地址（多为 index.m3u8 HLS 流）。若直接当 mp4 直链塞进 <video> 必然失败/黑屏。
// 该函数对无媒体扩展名的 URL 做轻量探测（只读首块数据），返回可播放的真实 { url, type }。
const MEDIA_EXT_RE = /\.(m3u8|mp4|webm|mov|mkv|ts|flv|ogg|ogv|m4v|aac)([?#]|$)/i
const M3U8_URL_RE = /(?:https?:)?\/\/[^\s'"<>]+?\.m3u8[^\s'"<>]*/i
const MP4_URL_RE = /(?:https?:)?\/\/[^\s'"<>]+?\.mp4[^\s'"<>]*/i

export async function resolveMediaUrl(
  url: string,
  proxyEnabled: boolean,
  proxyBase: string
): Promise<ResolvedMedia> {
  const m = url.match(MEDIA_EXT_RE)
  if (m) {
    return { url, type: m[1].toLowerCase() === 'm3u8' ? 'hls' : 'mp4' }
  }
  // 无媒体扩展名：探测内容特征，尝试提取真实播放地址
  // Android：fetch 受 WebView CORS 限制，探测改走 CapacitorHttp 原生 HTTP（整页文本，特征判定更全）
  if (isCapacitor()) {
    const r = await capFetchText(url, { headers: { accept: '*/*' }, timeoutMs: 8000 })
    if (!r.ok) return { url, type: 'mp4' }
    return detectResolvedMedia(url, r.text, r.contentType)
  }
  const target = proxyEnabled && proxyBase ? `${proxyBase}/proxy?url=${encodeURIComponent(url)}` : url
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 8000)
  try {
    const r = await fetch(target, {
      headers: { Range: 'bytes=0-16383', accept: '*/*' },
      signal: ctrl.signal
    })
    if (!r.ok || !r.body) return { url, type: 'mp4' }
    const ct = (r.headers.get('content-type') || '').toLowerCase()
    // 仅读取首个数据块做特征判定，避免整包下载大文件
    const reader = r.body.getReader()
    const { value } = await reader.read()
    reader.cancel().catch(() => {})
    const head = new TextDecoder().decode(value || new Uint8Array())
    return detectResolvedMedia(url, head, ct)
  } catch {
    return { url, type: 'mp4' }
  } finally {
    clearTimeout(timer)
  }
}

// 按响应头部文本 + Content-Type 判定真实媒体类型/地址（resolveMediaUrl 两路共用）
export function detectResolvedMedia(url: string, head: string, ct: string): ResolvedMedia {
  if (head.startsWith('#EXTM3U') || ct.includes('mpegurl')) return { url, type: 'hls' }
  if (head.includes('ftyp') || ct.includes('video/mp4') || ct.includes('video/webm')) {
    return { url, type: 'mp4' }
  }
  if (ct.includes('text/html') || /<html|<head|<!doctype/i.test(head)) {
    // 播放页：提取真实媒体地址（兼容 JSON 转义 \/）
    const unescaped = head.replace(/\\\//g, '/')
    const hlsUrl = unescaped.match(M3U8_URL_RE)
    if (hlsUrl) return { url: hlsUrl[0], type: 'hls' }
    const mp4Url = unescaped.match(MP4_URL_RE)
    if (mp4Url) return { url: mp4Url[0], type: 'mp4' }
    // 页面无直接媒体地址（可能需 JS 运行时解析）→ 回退原样，交由播放器报错提示
    return { url, type: 'mp4' }
  }
  return { url, type: 'mp4' }
}

// 把苹果CMS 风格 XML（at=xml 默认端点，如猫眼资源）解析为与 JSON 同构的 { list }
export function parseAppleCmsXml(text: string, _siteName: string): { list: any[] } {
  try {
    const doc = new DOMParser().parseFromString(text, 'application/xml')
    const videos = Array.from(doc.getElementsByTagName('video'))
    const list = videos.map((v) => {
      const get = (t: string) => (v.getElementsByTagName(t)[0]?.textContent || '').trim()
      return {
        vod_id: get('vod_id'),
        vod_name: get('vod_name'),
        vod_pic: get('vod_pic'),
        vod_play_from: get('vod_play_from'),
        vod_play_url: get('vod_play_url'),
        vod_remarks: get('vod_remarks')
      }
    })
    return { list }
  } catch {
    return { list: [] }
  }
}

// 把苹果CMS 风格 JSON 解析为 SearchResult[]，多个线路拆成可切换的播放源
export function parseAppleCms(json: any, siteName: string): SearchResult[] {
  const list = json?.list || []
  const out: SearchResult[] = []
  for (const v of list) {
    if (!v) continue
    const fromRaw: string = v.vod_play_from || ''
    const urlRaw: string = v.vod_play_url || ''
    // 线路组分隔符：苹果CMS v10 用 $$$，也有站点用逗号（如 jsyun,jsm3u8）。两种都兼容。
    let groups: string[]
    let urlGroups: string[]
    if (fromRaw.includes('$$$')) {
      groups = fromRaw.split('$$$')
      urlGroups = urlRaw.split('$$$')
    } else if (fromRaw.includes(',')) {
      groups = fromRaw.split(',')
      urlGroups = urlRaw.split(',')
    } else {
      groups = [fromRaw]
      urlGroups = [urlRaw]
    }
    const sources: VideoSource[] = []
    groups.forEach((from, gi) => {
      const fromName = (from || '').trim() || `线路${gi + 1}`
      const group = urlGroups[gi] || ''
      group.split('#').forEach((ep, k) => {
        const seg = ep.split('$')
        let name = ''
        let url = ''
        if (seg.length >= 2) {
          // 标准格式：集数$地址（地址本身可能含 $，用 slice 还原）
          name = (seg[0] || '').trim()
          url = seg.slice(1).join('$').trim()
        } else {
          // 兼容：无「集数$」前缀，整段即播放地址
          url = (seg[0] || '').trim()
        }
        if (!url) return
        const type: VideoSource['type'] = /\.m3u8(\?|$)/i.test(url) ? 'hls' : 'mp4'
        const epName = name || `源${k + 1}`
        sources.push({ name: `${fromName}·${epName}`, url, type })
      })
    })
    if (sources.length === 0) continue
    // 评分字段：兼容多种字段名（站点差异大）
    const rating =
      pickString(v, 'vod_score', 'vod_douban_score', 'vod_rating', 'score', 'rate', 'rating') || undefined
    out.push({
      id: `res-${siteName}-${v.vod_id}`,
      title: v.vod_name || '未命名',
      provider: siteName,
      poster: v.vod_pic || undefined,
      year: v.vod_year || undefined,
      description: v.vod_remarks || v.vod_blurb || '',
      rating,
      category: classifyCategory(v),
      // T01：列表页排序/筛选用（缺失不影响渲染）
      time: pickString(v, 'vod_time', 'time') || undefined,
      hits: pickNumber(v, 'vod_hits', 'hits'),
      typeName: pickString(v, 'type_name', 'typeName', 'vod_type', 'vod_class', 'class') || undefined,
      sources
    })
  }
  return out
}

// 分类映射：type_name/vod_type 优先，标题关键词回退，兜底「其他」
// 注意：classifyCategory 在 v1 为内部函数，本期为单测显式导出（barrel 以 superset 方式包含）。
export function classifyCategory(v: any): string {
  // 1) type_name / vod_type 优先（站点直接给出分类名）
  const tn = pickString(v, 'type_name', 'typeName', 'vod_type', 'vod_class', 'class') || ''
  if (tn) {
    const mapped = mapCategoryText(tn)
    if (mapped) return mapped
  }
  // 2) type_id 弱回退（仅靠通用站点约定；不同站点不一致）
  const tid = pickString(v, 'type_id', 'typeId')
  if (tid) {
    const map: Record<string, string> = {
      '1': '电影', '2': '电视剧', '3': '综艺', '4': '动漫', '5': '其他', '6': '其他'
    }
    if (map[tid]) return map[tid]
  }
  // 3) 标题关键词兜底
  const title = pickString(v, 'vod_name', 'title', 'name') || ''
  if (title) {
    const mapped = mapCategoryText(title)
    if (mapped) return mapped
  }
  return '其他'
}

// 文本 → 固定分类：短剧需先于「剧」类匹配，纪录片归「其他」
export function mapCategoryText(text: string): string | undefined {
  if (/(短剧|微短剧|竖屏剧|迷你剧)/i.test(text)) return '短剧'
  if (/(综艺|真人秀|脱口秀|选秀|娱乐)/i.test(text)) return '综艺'
  if (/(剧场版|电影|院线)/i.test(text)) return '电影'
  if (/(剧集|电视剧|连续剧|网剧|国产剧|台剧|港剧|韩剧|美剧|日剧|泰剧|英剧|剧)/i.test(text)) return '电视剧'
  if (/(动漫|动画|番剧)/i.test(text)) return '动漫'
  if (/(纪录)/i.test(text)) return '其他'
  return undefined
}

export function pickString(obj: any, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const x = obj?.[k]
    if (x != null && String(x).trim()) return String(x).trim()
  }
  return undefined
}

export function pickNumber(obj: any, ...keys: string[]): number | undefined {
  for (const k of keys) {
    const x = obj?.[k]
    if (x != null) {
      const n = Number(String(x).replace(/,/g, '').trim())
      if (isFinite(n)) return n
    }
  }
  return undefined
}

// resolveMediaUrl 在本模块内使用代理状态（兼容旧签名调用方仍传 proxyEnabled/proxyBase）
// 当调用方未传入（或传入空）时回退到共享状态。
export function resolveMediaUrlSafe(url: string): Promise<ResolvedMedia> {
  return resolveMediaUrl(url, getProxyEnabled(), getProxyBase())
}

export { proxifyUrl }
