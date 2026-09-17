/**
 * UI Token 常量（JS 侧）。
 * 与 styles.css 的 CSS 变量同步，供组件以 JS 常量消费圆角/间距/骨架等设计 token。
 * 同时 styles.css 已补充对应 CSS 变量定义（--radius-pill / --radius-lg / --radius-xl /
 * --space-2..4 / --skeleton-base / --skeleton-shine）。
 */

export const RADIUS = {
  /** 胶囊圆角（标签 / pill / 按钮） */
  pill: 999,
  /** 大圆角（卡片 / 面板） */
  lg: 12,
  /** 超大圆角（弹层 / 大卡片） */
  xl: 16,
  /** 默认圆角（按钮 / 小卡片） */
  sm: 6
} as const

export const SPACE = {
  /** 8px */
  s2: 8,
  /** 12px */
  s3: 12,
  /** 16px */
  s4: 16
} as const

/** 骨架屏配色（与 CSS 变量 --skeleton-base / --skeleton-shine 同步）。 */
export const SKELETON = {
  base: 'rgba(255,255,255,0.06)',
  shine: 'rgba(255,255,255,0.12)'
} as const
