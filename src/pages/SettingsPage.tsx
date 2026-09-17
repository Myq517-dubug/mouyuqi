import { useState } from 'react'
import { isCapacitor } from '../platform'
import { AppData, Settings, EnhanceLevel, AudioMode } from '../types'
import { DEFAULT_META_SOURCE, checkAllResourceSites } from '../providers'
import type { SiteCheck } from '../providers'

/**
 * 设置页：代理开关 / 测速 / 元数据补全 / 下载目录 / 主题 / 清空。
 * 从原 pages.tsx 原样迁移，并新增 P1「一键优化」：
 *   探活全部资源站 → 按延迟排序 → 关闭不可用源 → 推荐最佳音画档位 → 一键应用。
 */

interface OptResult {
  total: number
  ok: number
  bad: number
  fastest: number | null
  rec: { enhance: EnhanceLevel; audioMode: AudioMode }
  newSites: Settings['resourceSites']
  applied?: boolean
  error?: string
}

const ENHANCE_LABEL: Record<EnhanceLevel, string> = {
  off: '关闭',
  light: '轻度',
  medium: '中度',
  strong: '强力'
}
const AUDIO_LABEL: Record<AudioMode, string> = {
  dolby: '杜比环绕',
  spatial: '空间音频',
  bass: '低音增强',
  original: '原声'
}

export function SettingsPage({
  data,
  onUpdate,
  onPickDir,
  onClear
}: {
  data: AppData
  onUpdate: (p: Partial<Settings>) => void
  onPickDir: () => void
  onClear: () => void
}) {
  const s = data.settings
  const [optimizing, setOptimizing] = useState(false)
  const [opt, setOpt] = useState<OptResult | null>(null)

  const runOptimize = async () => {
    setOptimizing(true)
    setOpt(null)
    try {
      const checks: SiteCheck[] = await checkAllResourceSites(s.resourceSites)
      const okSites = checks.filter((c) => c.ok)
      const badSites = checks.filter((c) => !c.ok)
      const sorted = [...okSites].sort((a, b) => a.ms - b.ms)
      const fastest = sorted.length ? sorted[0].ms : null
      // 关闭不可用源（失效站置 enabled=false）
      const newSites = s.resourceSites.map((site) => {
        const chk = checks.find((c) => c.id === site.id)
        return chk && !chk.ok ? { ...site, enabled: false } : site
      })
      // 推荐音画档位：按最快可达延迟推断（弱网降级，避免卡顿）
      const rec: { enhance: EnhanceLevel; audioMode: AudioMode } =
        fastest != null && fastest < 500
          ? { enhance: 'strong', audioMode: 'spatial' }
          : fastest != null && fastest < 1500
          ? { enhance: 'medium', audioMode: 'spatial' }
          : { enhance: 'light', audioMode: 'original' }
      setOpt({ total: checks.length, ok: okSites.length, bad: badSites.length, fastest, rec, newSites })
    } catch (e: any) {
      setOpt({ total: 0, ok: 0, bad: 0, fastest: null, rec: { enhance: 'off', audioMode: 'original' }, newSites: s.resourceSites, error: String(e?.message || e) })
    } finally {
      setOptimizing(false)
    }
  }

  const applyOptimize = () => {
    if (!opt) return
    onUpdate({
      resourceSites: opt.newSites,
      playback: {
        ...(s.playback || { speed: 1 }),
        enhance: opt.rec.enhance,
        audioMode: opt.rec.audioMode
      }
    })
    setOpt({ ...opt, applied: true })
  }

  return (
    <>
      <div className="page-head"><h2>设置</h2></div>

      {/* P1：一键优化 */}
      <div className="optimize-card">
        <div className="optimize-main">
          <button className="btn optimize-btn" disabled={optimizing} onClick={runOptimize}>
            {optimizing ? '⚡ 优化中…' : '⚡ 一键优化'}
          </button>
          <div className="optimize-sub">自动探活资源站、排序、关闭失效源、推荐最佳音画</div>
        </div>
        {opt && !opt.error && (
          <div className="optimize-result">
            <div className="optimize-row">
              探活 <b>{opt.total}</b> 个资源站 · 可用 <b className="ok">{opt.ok}</b> · 已关闭失效{' '}
              <b className="bad">{opt.bad}</b>
              {opt.fastest != null && <> · 最快 <b>{opt.fastest}ms</b></>}
            </div>
            <div className="optimize-row">
              推荐：画质增强 <b>{ENHANCE_LABEL[opt.rec.enhance]}</b> · 音频{' '}
              <b>{AUDIO_LABEL[opt.rec.audioMode]}</b>
            </div>
            <button className="btn sm primary" onClick={applyOptimize} disabled={opt.applied}>
              {opt.applied ? '✓ 已应用' : '应用推荐'}
            </button>
          </div>
        )}
        {opt?.error && <div className="hint">优化失败：{opt.error}</div>}
      </div>

      <div className="panel">
        {!isCapacitor() && (
          <>
            <div className="field">
              <label className="switch">
                <input
                  type="checkbox"
                  checked={s.proxyEnabled}
                  onChange={(e) => onUpdate({ proxyEnabled: e.target.checked })}
                />
                启用本地代理（解决跨域 / 区域限制）
              </label>
              <div className="hint">通过内置本地代理转发视频请求，兼容大多数 HLS/MP4 源；搜索资源站也走此代理避免跨域。</div>
            </div>
            <div className="field">
              <label>出口代理（可选，解锁海外源）</label>
              <input
                value={s.upstreamProxy || ''}
                onChange={(e) => onUpdate({ upstreamProxy: e.target.value.trim() })}
                placeholder="如 http://127.0.0.1:7890 或 socks5://127.0.0.1:7891"
              />
              <div className="hint">
                填写你的 HTTP/SOCKS 代理后，本地代理转发会经此出网，可解锁被区域限制的海外源。
                需保持「本地代理」开启。留空则仅直连（国内源）。
              </div>
            </div>
          </>
        )}
        <div className="field">
          <label className="switch">
            <input
              type="checkbox"
              checked={s.speedTest}
              onChange={(e) => onUpdate({ speedTest: e.target.checked })}
            />
            搜索后自动测速优选线路
          </label>
          <div className="hint">对每个播放源做 HEAD 测速，播放默认选最快可达源，源列表标注延迟（绿色=快，红色=超时）。</div>
        </div>
        <div className="field">
          <label className="switch">
            <input
              type="checkbox"
              checked={s.metaEnabled}
              onChange={(e) => onUpdate({ metaEnabled: e.target.checked })}
            />
            启用元数据补全（海报 · 评分 · 简介）
          </label>
          <input
            value={s.metaSource || ''}
            onChange={(e) => onUpdate({ metaSource: e.target.value.trim() })}
            placeholder="元数据 API 模板，含 {title} 占位，如 https://x.com/api?q={title}"
          />
          <div className="hint">
            可选。填入 <code>{'{title}'}</code> 占位模板的 API（如社区豆瓣镜像），搜索时自动补全海报/年份/评分/简介，失败自动降级不影响播放。
            <button className="btn sm" style={{ marginLeft: 6 }} onClick={() => onUpdate({ metaSource: DEFAULT_META_SOURCE })}>
              填入示例豆瓣源
            </button>
          </div>
        </div>
        {!isCapacitor() && (
          <div className="field">
            <label>下载目录</label>
            <div className="row">
              <input value={s.downloadDir} readOnly style={{ flex: 1 }} />
              <button className="btn" onClick={onPickDir}>选择…</button>
            </div>
          </div>
        )}
        <div className="field">
          <label>主题</label>
          <select value={s.theme} onChange={(e) => onUpdate({ theme: e.target.value as any })}>
            <option value="dark">暗色</option>
            <option value="light">亮色</option>
          </select>
        </div>
        <button className="btn danger" onClick={onClear}>清空收藏与历史</button>
      </div>
    </>
  )
}
