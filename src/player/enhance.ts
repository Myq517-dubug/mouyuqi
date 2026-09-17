/**
 * 画质增强（实时渲染滤镜）常量与滤镜函数。
 * 从原 Player.tsx 原样迁移：ENHANCE_LEVELS / ENHANCE_LABEL / enhanceFilter。
 * 仅作用于 <video> 显示层的 CSS filter，不影响 hls.js / MSE 数据流。
 */

import type { EnhanceLevel } from '../types'

// 轻度：轻微对比度+饱和度提升（GPU 合成，性能开销极小）；
// 中/强：额外叠加 SVG feConvolveMatrix 锐化（Chromium 对视频滤镜走 GPU 加速）。
// EnhanceLevel 类型已上提至 types.ts，便于 Settings.playback.enhance 共享。
export const ENHANCE_LEVELS: EnhanceLevel[] = ['off', 'light', 'medium', 'strong']
export const ENHANCE_LABEL: Record<EnhanceLevel, string> = {
  off: '关',
  light: '轻',
  medium: '中',
  strong: '强'
}

export function enhanceFilter(level: EnhanceLevel): string {
  switch (level) {
    case 'light':
      return 'contrast(1.06) saturate(1.12) brightness(1.02)'
    case 'medium':
      return 'url(#m-enhance-sharpen) contrast(1.1) saturate(1.22) brightness(1.04)'
    case 'strong':
      return 'url(#m-enhance-sharpen-strong) contrast(1.16) saturate(1.35) brightness(1.06)'
    default:
      return 'none'
  }
}

// 源类型徽标文案：.m3u8 → HLS，其余 → MP4
export function srcTypeLabel(s: { type?: string; url: string }): string {
  const t = s.type && s.type !== 'other' ? s.type : s.url.includes('.m3u8') ? 'hls' : 'mp4'
  return t.toUpperCase()
}
