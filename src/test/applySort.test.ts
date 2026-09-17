import { describe, it, expect } from 'vitest'
import { applySort } from '../providers'
import type { SearchResult, CategorySort } from '../types'

function make(p: Partial<SearchResult> & { id: string }): SearchResult {
  return { title: p.id, provider: 'p1', ...p }
}

const base: SearchResult[] = [
  make({ id: 'a', rating: '5.0', time: '2024-01-01', hits: 10 }),
  make({ id: 'b', rating: '9.0', time: '2024-03-01', hits: 5 }),
  make({ id: 'c', rating: '7.0', time: '2024-02-01', hits: 20 })
]

describe('applySort', () => {
  it('default（含 undefined）保持原顺序，且不修改入参', () => {
    const copy = [...base]
    expect(applySort(base, 'default')).toEqual(base)
    expect(applySort(base, undefined)).toEqual(base)
    expect(base).toEqual(copy)
  })

  it('rating 降序', () => {
    const out = applySort(base, 'rating' as CategorySort)
    expect(out.map((i) => i.id)).toEqual(['b', 'c', 'a'])
  })

  it('time 降序（新→旧）', () => {
    const out = applySort(base, 'time' as CategorySort)
    expect(out.map((i) => i.id)).toEqual(['b', 'c', 'a'])
  })

  it('hits 降序', () => {
    const out = applySort(base, 'hits' as CategorySort)
    expect(out.map((i) => i.id)).toEqual(['c', 'a', 'b'])
  })

  it('缺失字段置尾（rating 缺失排最后）', () => {
    const list: SearchResult[] = [
      make({ id: 'a', rating: '8.0' }),
      make({ id: 'b' }), // 无 rating
      make({ id: 'c', rating: '6.0' })
    ]
    const out = applySort(list, 'rating' as CategorySort)
    expect(out.map((i) => i.id)).toEqual(['a', 'c', 'b'])
  })

  it('hits 缺失（undefined）置尾', () => {
    const list: SearchResult[] = [
      make({ id: 'a', hits: 3 }),
      make({ id: 'b' }),
      make({ id: 'c', hits: 9 })
    ]
    const out = applySort(list, 'hits' as CategorySort)
    expect(out.map((i) => i.id)).toEqual(['c', 'a', 'b'])
  })

  it('返回新数组而非原地排序原数组', () => {
    const ref = applySort(base, 'rating' as CategorySort)
    expect(ref).not.toBe(base)
  })
})
