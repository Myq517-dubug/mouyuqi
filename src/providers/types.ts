/**
 * providers 层内部类型定义（仅子模块内部共享，不直接对外 barrel 导出链）。
 */

import type { ResourceSite } from '../types'

/** resolveMediaUrl 解析结果：真实可播放地址 + 类型。 */
export type ResolvedMedia = { url: string; type: 'hls' | 'mp4' }

/** 资源站健康检查单站结果。 */
export type SiteCheck = {
  id: string
  name: string
  ok: boolean // 能否解析到 list
  alive: boolean // 站点是否可达（HTTP 2xx 且非空）
  count: number // 试探词返回条目数（参考）
  parsed: number // 实际解析出的可播条目数（关键）
  ms: number // 耗时
  error?: string
}

/** 资源站原始返回探测结果（排查"在线·解析0"）。 */
export type ProbeResult = {
  ok: boolean
  httpStatus?: number
  text: string
  parsed: number
  sample?: any
  error?: string
  ms: number
}

/** 跨源搜索诊断（逐站原始/解析条数）。 */
export type SearchDiag = {
  sites: number
  raw: number
  parsed: number
  perSite: { name: string; raw: number; parsed: number }[]
}

export type { ResourceSite }
