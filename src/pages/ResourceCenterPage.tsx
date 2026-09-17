/**
 * 资源中心页（ResourceCenterPage）。
 * 从原 pages.tsx 迁移，逻辑一字不改；共享组件 Card 来自 ../components。
 */

import { useEffect, useState } from 'react'
import type { AppData, ResourceSite, SearchResult } from '../types'
import {
  checkAllResourceSites,
  probeResourceSite,
  SiteCheck,
  ProbeResult
} from '../providers'
import { Card } from '../components'

const QUALITY_OPTIONS = ['1080P', '720P', '480P', '360P', '未知']

export function ResourceCenterPage({
  data,
  onAdd,
  onRemove,
  onUpdateSites,
  onImport,
  onExport
}: {
  data: AppData
  onAdd: (i: SearchResult) => void
  onRemove: (id: string) => void
  onUpdateSites: (sites: ResourceSite[]) => void
  onImport: () => void
  onExport: () => void
}) {
  const [sites, setSites] = useState<ResourceSite[]>(data.settings.resourceSites)
  const [name, setName] = useState('')
  const [api, setApi] = useState('')
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  const [srcName, setSrcName] = useState('')
  const [type, setType] = useState<'mp4' | 'hls'>('mp4')
  const [checks, setChecks] = useState<Record<string, SiteCheck>>({})
  const [checking, setChecking] = useState(false)
  const [probes, setProbes] = useState<Record<string, ProbeResult>>({})
  const [probingId, setProbingId] = useState<string | null>(null)
  const probe = async (site: ResourceSite) => {
    setProbingId(site.id)
    const r = await probeResourceSite(site)
    setProbes((p) => ({ ...p, [site.id]: r }))
    setProbingId(null)
  }
  const runCheck = async () => {
    setChecking(true)
    const list = await checkAllResourceSites(sites)
    const map: Record<string, SiteCheck> = {}
    for (const c of list) map[c.id] = c
    setChecks(map)
    setChecking(false)
  }

  useEffect(() => {
    setSites(data.settings.resourceSites)
  }, [data.settings.resourceSites])

  // 进入资源中心时自动探活一次，立即显示各站在线/离线状态（无需手动点"测试全部"）
  useEffect(() => {
    runCheck()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const addSite = () => {
    if (!name.trim() || !api.trim()) return
    const ns: ResourceSite[] = [
      ...sites,
      { id: 'res-' + Date.now(), name: name.trim(), api: api.trim(), enabled: true }
    ]
    setSites(ns)
    onUpdateSites(ns)
    setName('')
    setApi('')
  }
  const toggleSite = (id: string) => {
    const ns = sites.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s))
    setSites(ns)
    onUpdateSites(ns)
  }
  const removeSite = (id: string) => {
    const ns = sites.filter((s) => s.id !== id)
    setSites(ns)
    onUpdateSites(ns)
  }
  const addCustom = () => {
    if (!title.trim() || !url.trim()) return
    onAdd({
      id: 'cus-' + Date.now(),
      title: title.trim(),
      provider: 'custom',
      description: '自定义源',
      sources: [{ name: srcName.trim() || '源1', url: url.trim(), type }]
    })
    setTitle('')
    setUrl('')
    setSrcName('')
  }
  return (
    <>
      <div className="page-head">
        <h2>资源中心</h2>
        <button className="btn" onClick={onImport}>导入 JSON</button>
        <button className="btn" onClick={onExport}>导出 JSON</button>
      </div>

      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <h3 style={{ fontSize: 14, color: 'var(--text-dim)', margin: 0 }}>资源站（搜索源 · 苹果CMS 开放 API）</h3>
        <button className="btn" onClick={runCheck} disabled={checking}>{checking ? '测试中…' : '测试全部'}</button>
      </div>
      <div className="hint">点「测试全部」可探活各资源站可达性；离线站点建议删除或替换（端点经常变动）。搜索无结果多半是站点失效。</div>
      <div className="panel">
        <div className="row">
          <div className="field" style={{ flex: 1 }}>
            <label>站点名称</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="如：我的资源站" />
          </div>
          <div className="field" style={{ flex: 2 }}>
            <label>API 基地址</label>
            <input value={api} onChange={(e) => setApi(e.target.value)} placeholder="https://example.com/api.php/provide/vod/" />
          </div>
          <div className="field">
            <label>&nbsp;</label>
            <button className="btn primary" onClick={addSite}>添加站点</button>
          </div>
        </div>
        <div className="hint">
          资源站消费开放 API（关键词搜索返回国内可播源）。请仅添加你<strong>有权使用</strong>的来源。
        </div>
      </div>
      <div className="grid" style={{ marginTop: 12 }}>
        {sites.map((s) => {
          const c = checks[s.id]
          return (
            <div key={s.id} className="card">
              <div className="poster">{s.name}</div>
              <div className="meta">
                <div className="t">{s.name}</div>
                <div className="d" style={{ wordBreak: 'break-all' }}>{s.api}</div>
                <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                  <button
                    className={'btn sm ' + (s.enabled ? 'primary' : '')}
                    onClick={() => toggleSite(s.id)}
                  >
                    {s.enabled ? '已启用' : '已禁用'}
                  </button>
                  <button className="btn sm danger" onClick={() => removeSite(s.id)}>删除</button>
                  {checking && !c && <span className="tag check-pending">检测中…</span>}
                  {c && !c.alive && (
                    <span className="tag check-off" title={c.error || ''}>{c.error || '离线'}</span>
                  )}
                  {c && c.alive && c.parsed > 0 && (
                    <span className="tag check-on">在线 · 可播{c.parsed}条 · {c.ms}ms</span>
                  )}
                  {c && c.alive && c.parsed === 0 && (
                    <>
                      <span className="tag check-warn" title="站点可达但解析出 0 条可播源，格式可能不兼容">在线·解析0 · {c.ms}ms</span>
                      <button
                        className="btn sm"
                        onClick={() => probe(s)}
                        disabled={probingId === s.id}
                        title="抓取该站原始返回，便于排查解析失败原因"
                      >
                        {probingId === s.id ? '抓取中…' : '查看原始'}
                      </button>
                    </>
                  )}
                </div>
              </div>
              {probes[s.id] && (
                <div className="probe-box">
                  <div className="probe-head">
                    <span>
                      原始返回（{probes[s.id].ok ? `HTTP ${probes[s.id].httpStatus}` : '请求失败'} · 解析 {probes[s.id].parsed} 条
                      {probes[s.id].error ? ` · ${probes[s.id].error}` : ''}）
                      {probes[s.id].sample?.vod_play_url ? ` · play_from="${probes[s.id].sample.vod_play_from}"` : ''}
                    </span>
                    <button
                      className="btn sm"
                      onClick={() => setProbes((p) => { const n = { ...p }; delete n[s.id]; return n })}
                    >
                      收起
                    </button>
                  </div>
                  <pre className="probe">{probes[s.id].text || '(无内容)'}</pre>
                </div>
              )}
            </div>
          )
        })}
      </div>
      {Object.keys(checks).length > 0 &&
        (() => {
          const vals = Object.values(checks)
          const on = vals.filter((v) => v.alive).length
          const off = vals.length - on
          const playable = vals.filter((v) => v.parsed > 0).length
          return (
            <div className="status-line">
              已检测 {vals.length} 个站点：在线(可达) {on} · 离线 {off} · <span style={{ color: 'var(--ok)' }}>可播 {playable}</span>
              {playable === 0 && on > 0 && '（在线站均解析为 0，格式不兼容，需适配）'}
              {off > 0 && ' · 离线站建议删除或替换'}
            </div>
          )
        })()}

      <h3 style={{ fontSize: 14, color: 'var(--text-dim)', marginTop: 22 }}>我的自定义源（手动添加直链）</h3>
      <div className="panel">
        <div className="field">
          <label>标题</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例如：我的电影" />
        </div>
        <div className="row">
          <div className="field" style={{ flex: 1 }}>
            <label>播放地址（.mp4 直链 或 .m3u8）</label>
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://.../xxx.mp4" />
          </div>
          <div className="field">
            <label>源名称</label>
            <input value={srcName} onChange={(e) => setSrcName(e.target.value)} placeholder="源1" style={{ width: 120 }} />
          </div>
          <div className="field">
            <label>类型</label>
            <select value={type} onChange={(e) => setType(e.target.value as any)}>
              <option value="mp4">MP4</option>
              <option value="hls">HLS(m3u8)</option>
            </select>
          </div>
        </div>
        <button className="btn primary" onClick={addCustom}>添加</button>
      </div>
      <h3 style={{ fontSize: 14, color: 'var(--text-dim)', marginTop: 16 }}>已添加 ({data.customSources.length})</h3>
      {data.customSources.length === 0 ? (
        <div className="empty">还没有自定义源</div>
      ) : (
        <div className="grid">
          {data.customSources.map((it) => (
            <div key={it.id} className="card">
              <div className="poster">{it.title}</div>
              <div className="meta">
                <div className="t">{it.title}</div>
                <div className="d">{it.sources?.[0]?.url}</div>
                <button className="btn sm danger" style={{ marginTop: 6 }} onClick={() => onRemove(it.id)}>
                  删除
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
