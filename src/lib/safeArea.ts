/**
 * 安全区（safe-area）常量。
 * 迁移自 styles.css 的 env(safe-area-inset-*) 用法，集中为 JS 常量供组件/逻辑引用。
 *
 * 移动端 / 安卓 WebView（viewport-fit=cover 沉浸式）下这些值由系统填充，
 * 用于避开挖孔前摄 / 曲面边缘 / 系统导航栏 / home 指示条。
 */

/** 各方向安全区内缩像素（CSS env 在 styled 场景不可用时提供兜底）。 */
export const SAFE_AREA = {
  top: 'env(safe-area-inset-top, 0px)',
  right: 'env(safe-area-inset-right, 0px)',
  bottom: 'env(safe-area-inset-bottom, 0px)',
  left: 'env(safe-area-inset-left, 0px)'
} as const

/** 是否为支持 env(safe-area-inset-*) 的环境（CSS @supports 探测，运行时可用）。 */
export const SUPPORTS_SAFE_AREA =
  typeof CSS !== 'undefined' &&
  typeof (CSS as any).supports === 'function' &&
  (CSS as any).supports('padding', 'env(safe-area-inset-top)')
