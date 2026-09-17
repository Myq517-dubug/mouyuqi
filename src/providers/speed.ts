/**
 * 播放源测速与清晰度识别（核心算法模块）。
 * 从原 providers.ts 整体迁移，算法逻辑一字不改：measureSpeed / speedTestAll /
 * sortSourcesByLatency / qualityFromHeight / inferMp4Quality / classifySources。
 * 仅依赖 lib（mapLimit）与 platform，不反向依赖上层。
 */

import type { SearchResult, VideoSource } from '../types'
import { isCapacitor } from '../platform'
import { getProxyBase, getProxyEnabled, proxifyUrl } from './state'
import { mapLimit } from '../lib/mapLimit'

// ---------- 播放源测速 ----------
// 对单个源做 HEAD（失败回退 GET range）测速，返回毫秒；-1 表示不可达/超时
export async function measureSpeed(url: string): Promise<number> {
  const target = proxifyUrl(url)
  const start0 = performance.now()
  // Android：fetch 受 WebView CORS 限制必失败，测速改走 CapacitorHttp 原生 HTTP（HEAD→GET range 回退）
  if (isCapacitor()) {
    try {
      const http = (window as any)?.Capacitor?.Plugins?.CapacitorHttp
      if (!http?.request) return -1
      let status = 0
      try {
        const r = await http.request({ method: 'HEAD', url: target, connectTimeout: 3500, readTimeout: 3500 })
        status = Number(r?.status) || 0
      } catch {
        status = 0
      }
      if (!status || (status >= 400 && status !== 403 && status !== 405)) {
        try {
          const r = await http.request({
            method: 'GET',
            url: target,
            headers: { Range: 'bytes=0-1' },
            connectTimeout: 3500,
            readTimeout: 3500
          })
          status = Number(r?.status) || 0
        } catch {
          status = 0
        }
      }
      if (!status) return -1
      return Math.round(performance.now() - start0)
    } catch {
      return -1
    }
  }
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 3500)
  const start = start0
  try {
    let res: Response | null = null
    try {
      res = await fetch(target, { method: 'HEAD', signal: ctrl.signal, mode: 'cors' })
    } catch {
      res = null
    }
    if (!res || (res.status >= 400 && res.status !== 403 && res.status !== 405)) {
      try {
        res = await fetch(target, {
          method: 'GET',
          headers: { Range: 'bytes=0-1' },
          signal: ctrl.signal,
          mode: 'cors'
        })
      } catch {
        res = null
      }
    }
    if (!res) return -1
    return Math.round(performance.now() - start)
  } catch {
    return -1
  } finally {
    clearTimeout(timer)
  }
}

// 批量测速：给每个结果的每个源写入 speed 字段，返回新数组（不修改入参）
export async function speedTestAll(items: SearchResult[]): Promise<SearchResult[]> {
  return mapLimit(items, 6, async (it) => {
    const sources = it.sources || []
    const speeds = await mapLimit(sources, 4, (src) => measureSpeed(src.url))
    return {
      ...it,
      sources: sources.map((src, i) => ({ ...src, speed: speeds[i] }))
    }
  })
}

// ---------- 清晰度识别（T05）----------
// 已知 quality/height 的源保留；否则按 HLS/MP4 推断。
// HLS：取 height 字段（由 Player 在 MANIFEST_PARSED 回填）；MP4：源名/URL 关键词推断。
export function classifySources(sources: VideoSource[]): VideoSource[] {
  return sources.map((s) => {
    if (s.quality && s.height != null) return s
    const type =
      s.type && s.type !== 'other' ? s.type : /\.m3u8(\?|$)/i.test(s.url) ? 'hls' : 'mp4'
    let quality = s.quality || '未知'
    let height: number | undefined = s.height
    if (type === 'hls') {
      if (height != null) quality = qualityFromHeight(height)
    } else {
      const q = inferMp4Quality(s)
      quality = q.quality
      height = q.height
    }
    return { ...s, quality, height }
  })
}

export function qualityFromHeight(h: number): string {
  if (h >= 2160) return '2160P'
  if (h >= 1080) return '1080P'
  if (h >= 720) return '720P'
  if (h >= 480) return '480P'
  if (h >= 360) return '360P'
  return '未知'
}

const MP4_QUALITY_RE = /(4k|2160|1080|720|480|360)/i
function inferMp4Quality(s: VideoSource): { quality: string; height?: number } {
  const text = `${s.name || ''} ${s.url || ''}`
  const m = text.match(MP4_QUALITY_RE)
  if (!m) return { quality: '未知' }
  const k = m[1].toLowerCase()
  if (k === '4k' || k === '2160') return { quality: '2160P', height: 2160 }
  if (k === '1080') return { quality: '1080P', height: 1080 }
  if (k === '720') return { quality: '720P', height: 720 }
  if (k === '480') return { quality: '480P', height: 480 }
  if (k === '360') return { quality: '360P', height: 360 }
  return { quality: '未知' }
}

// ---------- 卡顿切源：按延迟排序（T04）----------
// 返回 sources 索引数组：已尝试过的源放末尾，剩余按 speed 升序；speed 缺失/-1 视为无穷大。
// Player 选第一个不等于当前 idx 且不在 tried 集合中的候选。
export function sortSourcesByLatency(
  sources: VideoSource[],
  tried: number[] = []
): number[] {
  const triedSet = new Set(tried)
  const indices = sources.map((_s, i) => i)
  indices.sort((a, b) => {
    const ta = triedSet.has(a) ? 1 : 0
    const tb = triedSet.has(b) ? 1 : 0
    if (ta !== tb) return ta - tb // 未尝试在前
    const sa = sources[a].speed
    const sb = sources[b].speed
    const va = sa != null && sa >= 0 ? sa : Number.POSITIVE_INFINITY
    const vb = sb != null && sb >= 0 ? sb : Number.POSITIVE_INFINITY
    return va - vb
  })
  return indices
}
