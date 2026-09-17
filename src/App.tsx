import { useEffect, useRef, useState } from 'react'
import Sidebar from './Sidebar'
import TitleBar from './TitleBar'
import { AppData, SearchResult, ResourceSite, PlaybackPrefs } from './types'
import { aggregateSearch, setCustomSources, setResourceSites, setProxyEnv, setMetaSource, resolveMediaUrl, DEFAULT_RESOURCE_SITES } from './providers'
import { isCapacitor, isIOS } from './platform'
import { persist as persistLib, dataRef } from './lib/persist'
import { QueueManager } from './lib/downloadQueue'
import { Home, SearchPage, LibraryPage, PlaylistPage, ResourceCenterPage, SettingsPage, DetailPage, CategoryPage, DiscoverPage, MePage } from './pages'
import { BottomTabBar, BrandTopBar } from './components'
import type { AppRoute } from './components'

export default function App() {
  const [data, setData] = useState<AppData | null>(null)
  const [proxyUrl, setProxyUrl] = useState('')
  const [view, setView] = useState('home')
  // 竖屏底部 Tab 路由（移动端）：home / discover / me；桌面端保留 Sidebar 驱动 view
  const [route, setRoute] = useState<AppRoute>('home')
  const [selected, setSelected] = useState<SearchResult | null>(null)
  // U8：视图导航栈（纯 React state 驱动返回，不依赖 history API，彻底规避 React #310）
  const [viewStack, setViewStack] = useState<string[]>(['home'])
  // 分类列表页会话态（返回首页不残留）
  const [catView, setCatView] = useState<{ id: string; name: string } | null>(null)
  const [toast, setToast] = useState('')
  const [dl, setDl] = useState<Record<string, number>>({})
  // v3：最新 data 镜像（dataRef）与落盘节流定时器（saveTimerRef）已下沉到 ./lib/persist，
  // 作为模块级共享状态，彻底消除闭包竞态与重复声明。
  const toastTimerRef = useRef<any>(null)
  // U8：边缘侧滑返回（左边缘右滑 → goBack）。仅用 ref 记录手势起点，不依赖 history API，避免 hook 顺序问题
  const touchStartX = useRef(0)
  const touchStartT = useRef(0)
  // P2：下载队列管理器（并发 3、失败重试 3 次），统一调度桌面/安卓下载
  const queueRef = useRef<QueueManager | null>(null)
  const [queueInfo, setQueueInfo] = useState<{ active: number; total: number; overall: number }>({
    active: 0,
    total: 0,
    overall: 0
  })
  if (!queueRef.current) {
    queueRef.current = new QueueManager(
      async (task, onP) => {
        const r: any = await window.api.download({
          url: task.url,
          name: task.id,
          savePath: task.dest,
          mergeSegments: task.mergeSegments
        })
        if (r && r.ok === false) throw new Error(r.error || '下载失败')
        onP?.(1, 1)
      },
      {
        concurrency: 3,
        maxRetries: 3,
        onState: () => {
          const q = queueRef.current!
          const c = q.counts()
          setQueueInfo({ active: c.active, total: c.total, overall: q.overallProgress() })
        }
      }
    )
  }

  const showToast = (t: string) => {
    setToast(t)
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    toastTimerRef.current = setTimeout(() => setToast(''), 2400)
  }

  useEffect(() => {
    let cancelled = false
    // 并行获取持久化数据与本地代理端口，确保首次搜索前代理环境已就绪
    // （否则资源站请求会直连外部站点被 CORS 拦截，导致搜索静默无结果）
    Promise.all([window.api.loadData(), window.api.getProxyUrl()]).then(([d, u]) => {
      if (cancelled) return
      const sites: ResourceSite[] =
        d.settings.resourceSites && d.settings.resourceSites.length
          ? d.settings.resourceSites
          : DEFAULT_RESOURCE_SITES
      const next: AppData = { ...d, settings: { ...d.settings, resourceSites: sites } }
      dataRef.current = next
      setData(next)
      setProxyUrl(u)
      setCustomSources(next.customSources)
      setResourceSites(sites)
      setProxyEnv(u, next.settings.proxyEnabled)
      setMetaSource(next.settings.metaSource || '')
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    window.api.onDownloadProgress((p) => {
      setDl((m) => ({ ...m, [p.id]: p.percent }))
      if (p.done) showToast(`下载完成：${p.id}`)
    })
  }, [])

  useEffect(() => {
    if (data) document.documentElement.setAttribute('data-theme', data.settings.theme)
  }, [data])

  // U7-v2：App 启动后把屏幕方向锁回竖屏（manifest fullSensor 允许旋转，
  // 这里在 JS 层锁竖；Player 全屏/退出全屏时再 unlock+lock 横/竖 实现自动横屏播放）
  useEffect(() => {
    if (!data) return
    if (isCapacitor()) {
      ;(screen.orientation as any)
        ?.lock?.('portrait')
        ?.catch?.(() => {
          /* WebView 不支持时忽略 */
        })
    }
  }, [data])

  if (!data) return <div className="empty">加载中…</div>

  // v3：persist 已下沉到 ./lib/persist（基于 dataRef 的函数式更新 + 落盘节流）。
  // 此处仅做薄封装：透传 updater/opts，并注入实际落盘函数 window.api.saveData。
  // 所有调用方（toggleFav / onProgress / updateSettings ...）签名与 v1 完全一致。
  const persist = (updater: (d: AppData) => AppData, opts?: { deferSave?: boolean }) => {
    // lib.persist 同步更新 dataRef 与落盘节流；落盘动作由 save 回调注入。
    // 内存 state（setData / setCustomSources）也在 save 回调里即时同步，保证闭包读到最新数据。
    persistLib(updater, opts, (next) => {
      setData(next)
      setCustomSources(next.customSources)
      window.api.saveData(next)
    })
  }

  // U8：导航栈 —— 进入新视图入栈，返回键/侧滑出栈；切 Tab 重置栈
  const navigate = (v: string) => {
    setViewStack((s) => [...s, v])
    setView(v)
  }
  const goBack = () => {
    if (viewStack.length <= 1) {
      // 已在首页（栈底）：交给系统处理（安卓退出 App），桌面无操作
      try {
        ;(window.api as any).exitApp?.()
      } catch {
        /* noop */
      }
      return
    }
    const next = viewStack.slice(0, -1)
    const prev = next[next.length - 1]
    setViewStack(next)
    setSelected(null)
    setCatView(null)
    setView(prev)
    if (prev === 'home' || prev === 'discover' || prev === 'me') setRoute(prev as AppRoute)
  }

  const open = (item: SearchResult) => {
    setSelected(item)
    navigate('detail')
  }

  const openCategory = (cat: { id: string; name: string }) => {
    setCatView(cat)
    navigate('category')
  }

  // 移动端底部 Tab 切换（竖屏导航）：切 Tab 重置导航栈，避免侧滑从 Tab 回其它 Tab
  const goTab = (r: AppRoute) => {
    setSelected(null)
    setCatView(null)
    setRoute(r)
    setViewStack([r])
    setView(r)
  }

  // U8：左边缘右滑手势 → goBack（仅当起始于屏幕最左 28px 且向右滑动 >60px、<700ms）
  const onTouchStart = (e: any) => {
    const t = e?.touches?.[0]
    if (!t) return
    touchStartX.current = t.clientX
    touchStartT.current = Date.now()
  }
  const onTouchEnd = (e: any) => {
    const t = e?.changedTouches?.[0]
    if (!t) return
    const dx = t.clientX - touchStartX.current
    const dt = Date.now() - touchStartT.current
    if (touchStartX.current < 28 && dx > 60 && dt < 700) goBack()
  }

  const toggleFav = (item: SearchResult) => {
    const exists = data.favorites.some((f) => f.id === item.id)
    persist((d) => ({
      ...d,
      favorites: exists ? d.favorites.filter((f) => f.id !== item.id) : [...d.favorites, item]
    }))
    showToast(exists ? '已取消收藏' : '已加入收藏')
  }

  const removeHistory = (id: string) => {
    persist((d) => {
      const history = { ...d.history }
      delete history[id]
      return { ...d, history }
    })
  }

  const addCustom = (item: SearchResult) => {
    persist((d) => ({ ...d, customSources: [...d.customSources, item] }))
    showToast('已添加到我的片单')
  }

  const removeCustom = (id: string) => {
    persist((d) => ({ ...d, customSources: d.customSources.filter((c) => c.id !== id) }))
  }

  const addToPlaylist = (item: SearchResult) => {
    if (data.playlist.some((p) => p.id === item.id)) {
      showToast('已在片单中')
      return
    }
    persist((d) => ({ ...d, playlist: [...d.playlist, item] }))
    showToast('已加入片单')
  }

  const removeFromPlaylist = (id: string) => {
    persist((d) => ({ ...d, playlist: d.playlist.filter((p) => p.id !== id) }))
  }

  const updateResourceSites = (sites: ResourceSite[]) => {
    persist((d) => ({ ...d, settings: { ...d.settings, resourceSites: sites } }))
    setResourceSites(sites)
  }

  const onProgress = (item: SearchResult, cur: number, dur: number) => {
    // v3：函数式更新 + 落盘节流（原实现每 timeupdate 全量同步写盘 ~4次/秒）
    persist(
      (d) => ({
        ...d,
        history: {
          ...d.history,
          [item.id]: { item, progress: cur, duration: dur, updatedAt: Date.now() }
        }
      }),
      { deferSave: true }
    )
  }

  const download = (item: SearchResult, url: string): string => {
    const id = `${item.id}-${Date.now()}`
    const safe = item.title.replace(/[\\/:*?"<>|]/g, '_')
    // 播放页地址（无扩展名，如 https://vv.jisuzyv.com/play/xxx）先解析为真实媒体地址，避免下载到 HTML
    void (async () => {
      const resolved = await resolveMediaUrl(url, data.settings.proxyEnabled, proxyUrl)
      const realUrl = resolved.url
      const ext = realUrl.includes('.m3u8') ? 'ts' : realUrl.split('.').pop()?.split('?')[0] || 'mp4'
      const savePath = `${data.settings.downloadDir}/${safe}.${ext}`
      // P2：经队列调度（并发 3 / 失败重试），保持每 id 进度回调
      queueRef.current!.enqueue({
        id,
        url: realUrl,
        name: id,
        dest: savePath,
        mergeSegments: realUrl.includes('.m3u8')
      })
    })()
    return id
  }

  const updateSettings = (patch: Partial<AppData['settings']>) => {
    persist((d) => ({ ...d, settings: { ...d.settings, ...patch } }))
    if (patch.upstreamProxy !== undefined) window.api.setUpstreamProxy(patch.upstreamProxy)
    if (patch.metaSource !== undefined) setMetaSource(patch.metaSource || '')
    if (patch.proxyEnabled !== undefined) setProxyEnv(proxyUrl, patch.proxyEnabled)
  }

  const updatePlayback = (p: PlaybackPrefs) => {
    persist((d) => ({ ...d, settings: { ...d.settings, playback: p } }))
  }

  const importSites = async () => {
    const text = await window.api.openJsonFile()
    if (!text) return
    try {
      const parsed = JSON.parse(text)
      const arr: any[] = Array.isArray(parsed)
        ? parsed
        : parsed?.sites || parsed?.resourceSites || []
      if (!Array.isArray(arr)) throw new Error('格式不正确')
      const valid: ResourceSite[] = arr
        .filter((s) => s && typeof s.api === 'string' && s.api.trim())
        .map((s) => ({
          id: s.id || 'res-' + Date.now() + Math.random().toString(36).slice(2, 7),
          name: s.name || s.api,
          api: String(s.api).trim().replace(/\/+$/, ''),
          enabled: s.enabled !== false
        }))
      if (!valid.length) {
        showToast('未解析到有效资源站')
        return
      }
      const existing = data.settings.resourceSites
      const merged = [...existing]
      let added = 0
      for (const v of valid) {
        if (!merged.some((m) => m.api === v.api)) {
          merged.push(v)
          added++
        }
      }
      updateResourceSites(merged)
      showToast(`已导入 ${added} 个资源站（共 ${merged.length}）`)
    } catch (e: any) {
      showToast('导入失败：' + (e?.message || 'JSON 解析错误'))
    }
  }

  const exportSites = async () => {
    const content = JSON.stringify(data.settings.resourceSites, null, 2)
    const r = await window.api.saveJsonFile(content)
    if (r.ok) showToast('已导出资源站 JSON')
    else showToast('导出失败：' + (r.error || ''))
  }

  const clearAll = () => {
    persist((d) => ({ ...d, favorites: [], history: {}, playlist: [] }))
    showToast('已清空收藏与历史')
  }

  return (
    // 移动端（Capacitor）加 platform-ios / platform-android class：CSS 去掉 TitleBar 占位 32px 并用 100dvh 铺满
    <div
      className={'app' + (isCapacitor() ? (isIOS() ? ' platform-ios' : ' platform-android') : '')}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <TitleBar />
      {/* 移动端顶部品牌区（桌面端由 CSS 隐藏） */}
      <BrandTopBar onSearch={() => goTab('discover')} />
      <div className="app-body">
        <Sidebar view={view} setView={(v) => { setSelected(null); setCatView(null); navigate(v) }} />
        <div className="main">
        {view === 'home' && (
          <Home
            data={data}
            onOpen={open}
            onOpenCategory={openCategory}
            onToast={showToast}
          />
        )}
        {view === 'discover' && (
          <DiscoverPage
            data={data}
            onGoSearch={() => navigate('search')}
            onGoCategory={openCategory}
            onToast={showToast}
          />
        )}
        {view === 'me' && (
          <MePage
            data={data}
            onOpen={open}
            onRemoveFav={toggleFav}
            onRemoveHistory={removeHistory}
            onRemovePlaylist={removeFromPlaylist}
            onAddCustom={addCustom}
            onRemoveCustom={removeCustom}
            onUpdateSites={updateResourceSites}
            onImport={importSites}
            onExport={exportSites}
            onUpdate={updateSettings}
            onPickDir={async () => {
              const d = await window.api.pickDir()
              if (d) updateSettings({ downloadDir: d })
            }}
            onClear={clearAll}
          />
        )}
        {view === 'search' && (
          <SearchPage
            onOpen={open}
            onAddPlaylist={addToPlaylist}
            playlistIds={data.playlist.map((p) => p.id)}
            settings={data.settings}
          />
        )}
        {view === 'library' && (
          <LibraryPage
            data={data}
            onOpen={open}
            onRemoveFav={toggleFav}
            onRemoveHistory={removeHistory}
          />
        )}
        {view === 'playlist' && (
          <PlaylistPage
            items={data.playlist}
            onOpen={open}
            onRemove={removeFromPlaylist}
          />
        )}
        {view === 'resource' && (
          <ResourceCenterPage
            data={data}
            onAdd={addCustom}
            onRemove={removeCustom}
            onUpdateSites={updateResourceSites}
            onImport={importSites}
            onExport={exportSites}
          />
        )}
        {view === 'settings' && (
          <SettingsPage
            data={data}
            onUpdate={updateSettings}
            onPickDir={async () => {
              const d = await window.api.pickDir()
              if (d) updateSettings({ downloadDir: d })
            }}
            onClear={clearAll}
          />
        )}
        {view === 'category' && catView && (
          <CategoryPage
            key={catView.id}
            category={catView.name}
            sites={data.settings.resourceSites}
            onOpen={open}
            onBack={() => goBack()}
            onToast={showToast}
          />
        )}
        {view === 'detail' && selected && (
          <DetailPage
            item={selected}
            proxyUrl={proxyUrl}
            proxyEnabled={data.settings.proxyEnabled}
            initialTime={data.history[selected.id]?.progress || 0}
            isFav={data.favorites.some((f) => f.id === selected.id)}
            inPlaylist={data.playlist.some((p) => p.id === selected.id)}
            playback={data.settings.playback}
            onFavorite={() => toggleFav(selected)}
            onTogglePlaylist={() => (data.playlist.some((p) => p.id === selected.id) ? removeFromPlaylist(selected.id) : addToPlaylist(selected))}
            onProgress={(c: number, d: number) => onProgress(selected, c, d)}
            onPlaybackChange={updatePlayback}
            onDownload={(url: string) => download(selected, url)}
            dl={dl}
            onToast={showToast}
          />
        )}
      </div>
      </div>
      {/* 移动端底部 Tab（桌面端由 CSS 隐藏） */}
      <BottomTabBar route={route} onChange={goTab} />
      {toast && <div className="toast">{toast}</div>}
      {queueInfo.total > 0 && queueInfo.active > 0 && (
        <div className="dl-queue">
          下载中 {queueInfo.active}/{queueInfo.total} · {queueInfo.overall}%
        </div>
      )}
    </div>
  )
}
