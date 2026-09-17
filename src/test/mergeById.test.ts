import { describe, it, expect } from 'vitest'
import { mergeById } from '../providers'
import type { SearchResult, VideoSource } from '../types'

function src(url: string, height = 1080): VideoSource {
  return { name: url, url, height }
}

function item(p: Partial<SearchResult> & { id: string; title: string; provider: string }): SearchResult {
  return { ...p }
}

describe('mergeById', () => {
  it('去重合并相同 id，sources 按追加顺序拼接', () => {
    const list: SearchResult[] = [
      item({ id: 'a', title: 'A', provider: 'p1', sources: [src('u1')], rating: '8.0' }),
      item({ id: 'a', title: 'A', provider: 'p1', sources: [src('u2')] })
    ]
    const out = mergeById(list)
    expect(out).toHaveLength(1)
    expect(out[0].sources).toHaveLength(2)
    expect(out[0].sources?.map((s) => s.url)).toEqual(['u1', 'u2'])
    // 首条字段保留；缺失字段由后续补全（rating 已存在不覆盖）
    expect(out[0].rating).toBe('8.0')
  })

  it('不合并不同 id', () => {
    const list: SearchResult[] = [
      item({ id: 'a', title: 'A', provider: 'p1' }),
      item({ id: 'b', title: 'B', provider: 'p2' })
    ]
    expect(mergeById(list)).toHaveLength(2)
  })

  it('后续条目补全首条缺失字段（poster/rating/year/category/time/hits/typeName）', () => {
    const list: SearchResult[] = [
      item({ id: 'a', title: 'A', provider: 'p1' }),
      item({
        id: 'a',
        title: 'A',
        provider: 'p1',
        poster: 'poster.jpg',
        rating: '9.1',
        year: '2024',
        category: '电影',
        time: '2024-01-01',
        hits: 123,
        typeName: '动作'
      })
    ]
    const out = mergeById(list)
    expect(out[0].poster).toBe('poster.jpg')
    expect(out[0].rating).toBe('9.1')
    expect(out[0].year).toBe('2024')
    expect(out[0].category).toBe('电影')
    expect(out[0].time).toBe('2024-01-01')
    expect(out[0].hits).toBe(123)
    expect(out[0].typeName).toBe('动作')
  })

  it('跳过无 id 或无条目的脏数据', () => {
    const list: SearchResult[] = [
      item({ id: 'a', title: 'A', provider: 'p1' }),
      // @ts-expect-error 测试脏数据容错
      { title: 'noId', provider: 'p2' },
      // @ts-expect-error 测试 null 容错
      null,
      undefined as unknown as SearchResult
    ]
    const out = mergeById(list)
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe('a')
  })

  it('空数组返回空数组', () => {
    expect(mergeById([])).toEqual([])
  })

  it('hits 用 ?? 补全：0 不被覆盖', () => {
    const list: SearchResult[] = [
      item({ id: 'a', title: 'A', provider: 'p1', hits: 0 }),
      item({ id: 'a', title: 'A', provider: 'p1', hits: 5 })
    ]
    const out = mergeById(list)
    expect(out[0].hits).toBe(0)
  })
})
