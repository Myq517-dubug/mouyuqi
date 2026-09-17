/**
 * 搜索聚合页（SearchPage）。
 * 从原 pages.tsx 迁移，并新增 P1 能力：搜索历史 chips（≤10 可点选/删除）、实时联想（防抖）、
 * 拼音/错别字智能纠偏（correctQuery）。共享组件 Card 来自 ../components。
 */

import { useRef, useState, type ChangeEvent } from 'react'
import type { SearchResult, Settings } from '../types'
import { aggregateSearch, postProcess, getLastSearchDiag } from '../providers'
import { Card } from '../components'
import { correctQuery } from '../lib/correct'
import {
  getSearchHistory,
  addSearchHistory,
  removeSearchHistory,
  clearSearchHistory
} from '../lib/searchHistory'

type Suggestion = { type: 'history' | 'correct'; label: string; value: string }

export function SearchPage({
  onOpen,
  onAddPlaylist,
  playlistIds,
  settings
}: {
  onOpen: (i: SearchResult) => void
  onAddPlaylist?: (i: SearchResult) => void
  playlistIds?: string[]
  settings: Settings
}) {
  const [q, setQ] = useState('')
  const [res, setRes] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('')
  // P1：搜索历史（本地持久化）
  const [history, setHistory] = useState<string[]>(() => getSearchHistory())
  // P1：实时联想（历史命中 + 智能纠偏）
  const [suggest, setSuggest] = useState<Suggestion[]>([])
  // v3（审查）：搜索竞态防护——连续两次搜索时，旧请求的迟到结果不再覆盖新结果
  const reqRef = useRef(0)
  const debRef = useRef<any>(null)

  // P1：根据当前输入计算联想项（防抖 150ms）
  const computeSuggest = (val: string) => {
    const kw = val.trim()
    if (!kw) {
      setSuggest([])
      return
    }
    const items: Suggestion[] = []
    // 智能纠偏：错别字 / 拼音首字母 → 候选正确词
    const c = correctQuery(kw)
    if (c.fromDict && c.corrected !== kw) {
      items.push({ type: 'correct', label: `猜你想搜：${c.corrected}`, value: c.corrected })
    }
    // 历史中包含当前输入（且不等于当前输入）→ 可直接复用
    for (const h of history) {
      if (h !== kw && h.toLowerCase().includes(kw.toLowerCase())) {
        items.push({ type: 'history', label: h, value: h })
      }
    }
    setSuggest(items.slice(0, 6))
  }

  const run = async (term?: string) => {
    const kw = (term ?? q).trim()
    if (!kw) {
      setRes([])
      setStatus('')
      return
    }
    if (term !== undefined) setQ(term)
    setSuggest([])
    // P1：写入搜索历史（去重置顶，最多 10 条）
    setHistory(addSearchHistory(kw))
    const my = ++reqRef.current
    setLoading(true)
    setRes([])
    setStatus('正在跨源聚合搜索…')
    let r: SearchResult[] = []
    let errMsg = ''
    try {
      // 全局兜底超时：即便某个源卡死，UI 也能在 12s 内恢复，避免一直卡在"搜索中"
      r = await Promise.race<SearchResult[]>([
        aggregateSearch(kw),
        new Promise<SearchResult[]>((resolve) => setTimeout(() => resolve([]), 12000))
      ])
    } catch (e: any) {
      errMsg = String(e?.message || e)
      console.error('[search] error', e)
    } finally {
      if (my !== reqRef.current) return
      setLoading(false)
    }
    setRes(r)
    const d = getLastSearchDiag()
    setStatus(
      errMsg
        ? `搜索出错：${errMsg}`
        : r.length
        ? `已聚合 ${r.length} 个结果（来自 ${d.sites} 个资源站），点击卡片即播放`
        : d.sites === 0
        ? '未配置/未启用任何资源站，请到「资源中心」添加并启用'
        : d.parsed === 0
        ? `已查询 ${d.sites} 个资源站，返回原始 ${d.raw} 条、但解析出 0 条可播源（多为格式不兼容，详见下方逐站诊断）`
        : `已查询 ${d.sites} 个资源站，解析出 0 条可播源，可能该关键词无匹配`
    )
    // 搜索结果后处理：测速优选 + 元数据补全（按设置，异步不阻塞首屏）
    if ((settings.speedTest || settings.metaEnabled) && r.length) {
      postProcess(r, { speedTest: settings.speedTest, metaEnabled: settings.metaEnabled })
        .then((processed) => {
          if (my === reqRef.current) setRes(processed)
        })
        .catch(() => {})
    }
  }

  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value
    setQ(v)
    if (debRef.current) clearTimeout(debRef.current)
    debRef.current = setTimeout(() => computeSuggest(v), 150)
  }

  const removeHist = (h: string) => setHistory(removeSearchHistory(h))
  const clearHist = () => {
    clearSearchHistory()
    setHistory([])
  }

  return (
    <>
      <div className="page-head">
        <h2>搜索聚合</h2>
        <div className="search-bar">
          <input
            value={q}
            onChange={onChange}
            onKeyDown={(e) => e.key === 'Enter' && run()}
            placeholder="输入片名，跨资源站并行聚合搜索…"
          />
          <button className="btn primary" onClick={() => run()}>搜索</button>
        </div>
      </div>

      {/* P1：搜索历史 chips（输入为空时展示） */}
      {!q.trim() && history.length > 0 && (
        <div className="search-history">
          <div className="sh-head">
            <span>搜索历史</span>
            <button className="sh-clear" onClick={clearHist}>清空</button>
          </div>
          <div className="sh-chips">
            {history.map((h) => (
              <span className="sh-chip" key={h} onClick={() => run(h)}>
                {h}
                <button
                  className="sh-x"
                  title="删除"
                  onClick={(e) => {
                    e.stopPropagation()
                    removeHist(h)
                  }}
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* P1：实时联想浮层（有输入且存在联想项时展示） */}
      {q.trim() && suggest.length > 0 && (
        <div className="sugg">
          {suggest.map((s) => (
            <div className="sugg-item" key={s.type + s.value} onClick={() => run(s.value)}>
              {s.label}
            </div>
          ))}
        </div>
      )}

      <div className="hint">
        搜索词会并行查询「已启用的资源站」+ 我的自定义源。资源站返回国内可播源，可在
        <strong>资源中心</strong>增删。结果点卡片即播放，点「＋」加入片单。
      </div>
      {loading && <div className="empty">搜索中…</div>}
      {!loading && res.length === 0 && (
        q.trim() ? (
          <div className="empty">
            暂无结果。请确认已启用至少一个资源站，并到「资源中心」点「测试全部」排查站点是否可达（免费资源站端点经常变动，离线站请删除或替换）。
          </div>
        ) : (
          <div className="empty">输入片名 / 演员，跨资源站并行聚合搜索</div>
        )
      )}
      {!loading && res.length === 0 && q.trim() && (() => {
        const d = getLastSearchDiag()
        if (!d.perSite.length) return null
        return (
          <div className="diag-box">
            <div className="diag-title">搜索逐站诊断（原始返回 / 解析出可播）</div>
            {d.perSite.map((s) => (
              <div key={s.name} className="diag-row">
                <span className="diag-name">{s.name}</span>
                <span className={s.parsed > 0 ? 'diag-ok' : 'diag-bad'}>
                  原始 {s.raw} / 可播 {s.parsed}
                </span>
              </div>
            ))}
            {d.parsed === 0 && (
              <div className="diag-hint">
                所有站点都解析为 0 条可播源 → 几乎可以确定是「返回格式与解析器不兼容」。
                请把上方某站「原始 N / 可播 0」的截图发我，我据此适配该站格式。
              </div>
            )}
          </div>
        )
      })()}
      {status && !loading && <div className="status-line">{status}</div>}
      <div className="grid">
        {res.map((it) => (
          <Card
            key={it.id}
            item={it}
            onOpen={onOpen}
            onAddPlaylist={onAddPlaylist}
            inPlaylist={playlistIds?.includes(it.id)}
          />
        ))}
      </div>
    </>
  )
}
