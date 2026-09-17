import { describe, it, expect } from 'vitest'
import { classifyCategory } from '../providers'

// classifyCategory(v) 入参为站点原始条目对象，优先读取 type_name / typeName / vod_type 等字段，
// 经 mapCategoryText 关键词匹配后归类；无关键词时回退标题关键词，最终兜底为「其他」。

describe('classifyCategory', () => {
  it('电影：type_name 含「电影」归类电影', () => {
    expect(classifyCategory({ type_name: '电影' })).toBe('电影')
  })

  it('综艺：type_name 含「综艺」归类综艺', () => {
    expect(classifyCategory({ type_name: '综艺' })).toBe('综艺')
  })

  it('电视剧：type_name 含「连续剧」归类电视剧', () => {
    expect(classifyCategory({ type_name: '连续剧' })).toBe('电视剧')
  })

  it('动漫：type_name 含「动漫」归类动漫', () => {
    expect(classifyCategory({ type_name: '动漫' })).toBe('动漫')
  })

  it('短剧：type_name 含「短剧」优先归类短剧（先于「剧」）', () => {
    expect(classifyCategory({ type_name: '短剧' })).toBe('短剧')
  })

  it('无关键词归其他：未匹配任何分类时兜底为「其他」', () => {
    expect(classifyCategory({ type_name: '未分类内容' })).toBe('其他')
  })

  it('标题关键词兜底：type_name 无、标题含分类词', () => {
    expect(classifyCategory({ title: '某热门动漫番剧' })).toBe('动漫')
  })

  it('type_id 弱回退：type_id=1 映射电影', () => {
    expect(classifyCategory({ type_id: '1' })).toBe('电影')
  })
})
