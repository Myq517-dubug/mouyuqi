/**
 * 统一骨架屏组件（shimmer 动画 + 圆角与卡片一致）。
 * 新建组件，供分类页/首页加载态复用；样式引用 styles.css 的 --skeleton-* 变量与 shimmer keyframes。
 */

import { SKELETON } from './Token'

/** 单个海报卡片骨架（圆角与 .card 一致）。 */
export function SkeletonCard() {
  return (
    <div className="card sk-card">
      <div className="sk-poster" />
      <div className="sk-line" />
    </div>
  )
}

/**
 * 骨架网格：rows × cols 个海报骨架（默认 2 行 × 3 列，与原分类页一致）。
 */
export function SkeletonGrid({ rows = 2, cols = 3 }: { rows?: number; cols?: number }) {
  const count = rows * cols
  return (
    <div className="grid">
      {Array.from({ length: count }).map((_v, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  )
}

export { SKELETON }
