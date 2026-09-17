/**
 * 播放控制条常量与源分组逻辑（controls）。
 * 从原 Player.tsx 原样迁移：SPEED_OPTIONS / bestIdx / QUALITY_RANK / buildGroups（源分组）。
 * 算法逻辑一字不改。
 */

import type { VideoSource } from '../types'
import { classifySources } from '../providers'

// 倍速下拉
export const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2]
export const QUALITY_RANK: Record<string, number> = {
  '2160P': 6, '4K': 6, '1080P': 5, '720P': 4, '480P': 3, '360P': 2, '未知': 0
}

// 选最快可达源：speed 最小且 >=0；无测速信息时回退 0
export function bestIdx(ss: VideoSource[]): number {
  let bi = 0
  let bf = Infinity
  ss.forEach((s, i) => {
    if (s.speed !== undefined && s.speed >= 0 && s.speed < bf) {
      bf = s.speed
      bi = i
    }
  })
  return bi
}

export type GroupedSource = { source: VideoSource; idx: number; quality: string; format: string }
export type Group = { key: string; quality: string; format: string; items: GroupedSource[]; collapsed: boolean }

// 源分组（按 清晰度 × 格式 二维折叠）
export function buildGroups(
  sources: VideoSource[],
  heights: Record<number, number>,
  collapsedMap: Record<string, boolean>
): Group[] {
  // 注入 HLS 测得的高度，再走 classifySources
  const enriched = sources.map((s, i) => ({ ...s, height: heights[i] ?? s.height }))
  const classified = classifySources(enriched)
  const list: GroupedSource[] = classified.map((source, i) => {
    const format =
      source.type && source.type !== 'other' ? source.type.toUpperCase() : source.url.includes('.m3u8') ? 'HLS' : 'MP4'
    const quality = source.quality || '未知'
    return { source, idx: i, format, quality }
  })
  const map = new Map<string, GroupedSource[]>()
  for (const e of list) {
    const key = `${e.quality}|${e.format}`
    const arr = map.get(key) || []
    arr.push(e)
    map.set(key, arr)
  }
  const groups: Group[] = [...map.entries()].map(([key, items]) => {
    const quality = items[0].quality
    const format = items[0].format
    return {
      key,
      quality,
      format,
      items,
      collapsed: collapsedMap[key] != null ? !!collapsedMap[key] : quality === '未知'
    }
  })
  // 排序：未知置底，其余按清晰度高→低
  groups.sort((a, b) => {
    const au = a.quality === '未知' ? 1 : 0
    const bu = b.quality === '未知' ? 1 : 0
    if (au !== bu) return au - bu
    return (QUALITY_RANK[b.quality] || 0) - (QUALITY_RANK[a.quality] || 0)
  })
  return groups
}
