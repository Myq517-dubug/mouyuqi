import { describe, it, expect } from 'vitest'
import { buildRecommendations } from '../providers'
import type { SearchResult, HistoryEntry } from '../types'

const mk = (id: string, over: Partial<SearchResult> = {}): SearchResult => ({
  id,
  title: id,
  provider: 'p',
  ...over
})

const all: SearchResult[] = Array.from({ length: 30 }, (_, i) => mk(`v${i}`, { rating: String(i % 10) }))

describe('buildRecommendations', () => {
  it('空输入返回空数组', () => {
    expect(buildRecommendations([], { seed: 0.42 })).toEqual([])
  })

  it('limit 生效：结果不超过 limit', () => {
    const out = buildRecommendations(all, { seed: 0.42, limit: 5 })
    expect(out.length).toBeLessThanOrEqual(5)
  })

  it('同 seed 可复现：两次结果完全一致', () => {
    const a = buildRecommendations(all, { seed: 0.42, limit: 12 })
    const b = buildRecommendations(all, { seed: 0.42, limit: 12 })
    expect(a.map((i) => i.id)).toEqual(b.map((i) => i.id))
  })

  it('不同 seed 有差异：换一批可刷新顺序', () => {
    const a = buildRecommendations(all, { seed: 0.42, limit: 12 })
    const b = buildRecommendations(all, { seed: 0.99, limit: 12 })
    // 至少顺序或内容有变化（非恒等）
    expect(a.map((i) => i.id)).not.toEqual(b.map((i) => i.id))
  })

  it('history 偏好影响结果：历史项优先召回', () => {
    const history: Record<string, HistoryEntry> = {
      v29: { item: mk('v29'), progress: 10, duration: 100, updatedAt: Date.now() }
    }
    const out = buildRecommendations(all, { seed: 0.42, limit: 12, history })
    // 历史项应出现在结果中（被召回）
    expect(out.some((i) => i.id === 'v29')).toBe(true)
  })

  it('输出均为 SearchResult 且唯一（无重复 id）', () => {
    const out = buildRecommendations(all, { seed: 0.42, limit: 12 })
    const ids = out.map((i) => i.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
