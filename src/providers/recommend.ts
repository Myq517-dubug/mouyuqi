/**
 * 猜你喜欢推荐（核心算法模块）。
 * 从原 providers.ts 整体迁移：buildRecommendations（含 rankTop / numRating / rankScore 内部辅助）。
 * mulberry32 引用 lib/random（保持 v1 在 providers.ts 的导出名不变，从 lib 重新导出）。
 */

import type { HistoryEntry, SearchResult } from '../types'
import { mulberry32 } from '../lib/random'
import type { HomeFeed } from '../types'

// 保持 v1 在 providers.ts 的 mulberry32 导出（实现已迁移至 lib/random）。
export { mulberry32 }

function numRating(it: SearchResult): number {
  const n = Number(it.rating)
  return isFinite(n) ? n : -1
}
function rankScore(it: SearchResult): number {
  const r = numRating(it)
  if (r < 0) return -1 // 缺失置尾
  const srcCount = (it.sources || []).length
  return r * (1 + Math.log(1 + srcCount))
}

// 无历史时回退「热门」：复用 ranking 逻辑
function rankTop(all: SearchResult[], limit: number): SearchResult[] {
  const hasAnyRating = all.some((it) => numRating(it) >= 0)
  const arr = [...all].sort((a, b) => {
    if (hasAnyRating) return rankScore(b) - rankScore(a)
    return (b.sources?.length || 0) - (a.sources?.length || 0)
  })
  return arr.slice(0, limit)
}

// 猜你喜欢：历史偏好（分类/来源站权重）+ 多源 log 加权 + 评分加权 + 种子扰动
export function buildRecommendations(
  all: SearchResult[],
  opts: { seed: number; history?: Record<string, HistoryEntry>; limit?: number }
): SearchResult[] {
  const { seed, history, limit = 12 } = opts
  // Bug2 根因（v3）：seed 为 [0,1) 小数（0.42 / Math.random()），原实现两处失效——
  //   ① 无历史：直接返回 rankTop，完全忽略 seed；
  //   ② 有历史：mulberry32(seed + idx) 经 >>> 0 取整后 = mulberry32(idx)，
  //     不同 seed 产出的 jitter 完全相同 → 排序永远不变。
  // 修复：seed 统一放大为整数（Math.floor(seed * 1e9)）后再参与伪随机。
  const seedInt = Math.floor(seed * 1e9) >>> 0
  const histItems = history ? Object.values(history) : []
  if (!histItems.length) {
    // 无历史：热门打底（limit×3 候选）+ 种子洗牌，保证「换一批」可刷新
    const candidates = rankTop(all, Math.min(all.length, limit * 3))
    const rnd = mulberry32(seedInt)
    const jittered = candidates.map((it) => ({ it, k: rnd() }))
    jittered.sort((a, b) => a.k - b.k)
    return jittered.slice(0, limit).map((x) => x.it)
  }
  // 最近 N=20 条历史统计偏好权重
  const recent = [...histItems].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 20)
  const catW = new Map<string, number>()
  const provW = new Map<string, number>()
  for (const h of recent) {
    const c = h.item.category || '其他'
    catW.set(c, (catW.get(c) || 0) + 1)
    const p = h.item.provider
    if (p) provW.set(p, (provW.get(p) || 0) + 1)
  }
  const total = recent.length || 1
  const scored = all.map((it, idx) => {
    const catMatch = (catW.get(it.category || '其他') || 0) / total
    const providerMatch = (provW.get(it.provider) || 0) / total
    const r = numRating(it)
    const ratingScore = r >= 0 ? r : 0
    const srcScore = Math.log(1 + (it.sources?.length || 0))
    const jitter = mulberry32(seedInt + idx)() * 0.3
    return { it, score: catMatch * 2 + providerMatch * 1 + ratingScore * 0.5 + srcScore * 1 + jitter }
  })
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, limit).map((s) => s.it)
}

// 兼容引用（保持与 home.ts 同构的 HomeFeed 类型可导入）。
export type { HomeFeed }
