import { useEffect, useState } from 'react'
import { SearchResult, VideoSource, PlaybackPrefs } from '../types'
import Player from '../Player'

/**
 * 详情页：海报 / 简介 / 收藏 / 片单 / 下载 + 内嵌 Player 播放。
 * 从原 pages.tsx 原样迁移，props 契约与 v1 完全一致。
 */
export function DetailPage({
  item,
  proxyUrl,
  proxyEnabled,
  initialTime,
  isFav,
  inPlaylist,
  playback,
  onFavorite,
  onTogglePlaylist,
  onProgress,
  onPlaybackChange,
  onDownload,
  dl,
  onToast
}: {
  item: SearchResult
  proxyUrl: string
  proxyEnabled: boolean
  initialTime: number
  isFav: boolean
  inPlaylist: boolean
  playback?: PlaybackPrefs
  onFavorite: () => void
  onTogglePlaylist: () => void
  onProgress: (cur: number, dur: number) => void
  onPlaybackChange?: (p: PlaybackPrefs) => void
  onDownload: (url: string) => string
  dl: Record<string, number>
  onToast?: (msg: string) => void
}) {
  const sources: VideoSource[] = item.sources || []
  const [dlId, setDlId] = useState<string | null>(null)
  const pct = dlId ? dl[dlId] : undefined

  // 后台自动小窗（PiP）：进入本页后，切后台/锁屏时自动进入画中画。
  // 依赖平台层 enterPip（内部 document.querySelector('video')），浏览器需用户曾手势授权（点过"画中画"按钮）。
  useEffect(() => {
    const onVis = () => {
      if (document.hidden) {
        ;(window.api.enterPip?.() as Promise<{ ok: boolean; error?: string }>).catch?.(() => {})
      }
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  return (
    <>
      <div className="page-head">
        <h2>{item.title}</h2>
        {item.rating && <span className="pill rating">★ {item.rating}</span>}
        <button className={'btn ' + (isFav ? 'danger' : 'primary')} onClick={onFavorite}>
          {isFav ? '取消收藏' : '收藏'}
        </button>
        <button className={'btn ' + (inPlaylist ? '' : 'primary')} onClick={onTogglePlaylist}>
          {inPlaylist ? '移出片单' : '加入片单'}
        </button>
        {sources[0] && (
          <button
            className="btn"
            onClick={() => {
              const id = onDownload(sources[0].url)
              setDlId(id)
            }}
          >
            下载当前源
          </button>
        )}
        {pct !== undefined && <span className="pill">下载 {pct}%</span>}
      </div>
      {item.poster && (
        <img className="detail-poster" src={item.poster} alt={item.title} />
      )}
      <p className="hint">
        {item.description} · {item.year} · 来自 {item.provider}
        {item.rating ? ` · 评分 ${item.rating}` : ''}
      </p>
      {sources.length === 0 ? (
        <div className="empty">该资源暂无可播放源</div>
      ) : (
        <Player
          sources={sources}
          title={item.title}
          proxyEnabled={proxyEnabled}
          proxyUrl={proxyUrl}
          initialTime={initialTime}
          playback={playback}
          onProgress={onProgress}
          onPlaybackChange={onPlaybackChange}
          onToast={onToast}
        />
      )}
      <div className="hint" style={{ marginTop: 8 }}>
        下方卡片可手动切换播放源；播放失败会<strong>自动切到下一源</strong>。
      </div>
    </>
  )
}
