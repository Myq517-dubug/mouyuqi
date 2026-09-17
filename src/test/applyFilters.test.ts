import { describe, it, expect } from 'vitest'
import { applyFilters } from '../providers'
import type { SearchResult, CategoryFilters } from '../types'

const mk = (over: Partial<SearchResult>): SearchResult => ({
  id: Math.random().toString(36).slice(2),
  title: 't',
  provider: 'p',
  ...over
})

const vsrc = (url: string, height: number) => ({ name: url, url, height })

const items: SearchResult[] = [
  mk({ year: '2023', typeName: '电影', provider: 'A', sources: [vsrc('u', 1080)] }),
  mk({ year: '2022', typeName: '电视剧', provider: 'B', sources: [vsrc('u', 720)] }),
  mk({ year: '2023', typeName: '综艺', provider: 'A', sources: [vsrc('u', 480)] }),
  mk({ year: '2021', typeName: '动漫', provider: 'C', sources: [vsrc('u', 360)] })
]

describe('applyFilters', () => {
  it('按年份过滤', () => {
    const out = applyFilters(items, { year: '2023' } as CategoryFilters)
    expect(out).toHaveLength(2)
    expect(out.every((i) => i.year === '2023')).toBe(true)
  })

  it('按类型（typeName）过滤', () => {
    const out = applyFilters(items, { typeName: '电影' } as CategoryFilters)
    expect(out).toHaveLength(1)
    expect(out[0].typeName).toBe('电影')
  })

  it('按来源（provider）过滤', () => {
    const out = applyFilters(items, { provider: 'A' } as CategoryFilters)
    expect(out).toHaveLength(2)
    expect(out.every((i) => i.provider === 'A')).toBe(true)
  })

  it('按清晰度（quality）过滤：取源最大高度对应的档位', () => {
    // 1080P 仅第一条例匹配
    const out = applyFilters(items, { quality: '1080P' } as CategoryFilters)
    expect(out).toHaveLength(1)
    expect(out[0].sources?.[0].height).toBe(1080)
  })

  it('空条件（undefined）返回原数组引用内容', () => {
    const out = applyFilters(items)
    expect(out).toHaveLength(items.length)
  })

  it('空过滤对象返回全部', () => {
    const out = applyFilters(items, {} as CategoryFilters)
    expect(out).toHaveLength(items.length)
  })

  it('多条件组合取交集', () => {
    const out = applyFilters(items, { year: '2023', provider: 'A' } as CategoryFilters)
    expect(out).toHaveLength(2)
    expect(out.every((i) => i.year === '2023' && i.provider === 'A')).toBe(true)
  })
})
