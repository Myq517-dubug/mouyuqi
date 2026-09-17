import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  loadData: () => ipcRenderer.invoke('app:loadData'),
  saveData: (d: any) => ipcRenderer.invoke('app:saveData', d),
  getProxyUrl: () => ipcRenderer.invoke('app:getProxyUrl'),
  setUpstreamProxy: (v: string) => ipcRenderer.invoke('app:setUpstreamProxy', v),
  openFile: () => ipcRenderer.invoke('app:openFile'),
  openJsonFile: () => ipcRenderer.invoke('app:openJsonFile'),
  saveJsonFile: (content: string) => ipcRenderer.invoke('app:saveJsonFile', content),
  pickDir: () => ipcRenderer.invoke('app:pickDir'),
  download: (opts: { url: string; name: string; savePath: string; mergeSegments?: boolean }) =>
    ipcRenderer.invoke('app:download', opts),
  onDownloadProgress: (cb: (p: { id: string; percent: number; done: boolean }) => void) => {
    ipcRenderer.on('app:download-progress', (_e, p) => cb(p))
  },
  // 画中画：在渲染进程内直接操作 <video>（无需主进程转发）；不支持则返回 ok:false
  enterPip: async () => {
    try {
      const v = document.querySelector('video') as any
      if (!v) return { ok: false, error: '当前没有可画中画的视频' }
      if (!document.pictureInPictureEnabled) return { ok: false, error: '当前环境不支持画中画' }
      await v.requestPictureInPicture()
      return { ok: true }
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) }
    }
  },
  exitPip: async () => {
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture()
    } catch {
      /* no-op */
    }
  },
  // 媒体会话（通知栏/锁屏控制）：渲染进程内热更新 navigator.mediaSession
  setMediaSession: (meta: { title: string; artist?: string; artwork?: string[] }) => {
    const nav: any = navigator
    if (!nav?.mediaSession) return
    try {
      nav.mediaSession.metadata = new (window as any).MediaMetadata({
        title: meta.title || 'M快播',
        artist: meta.artist || 'M快播',
        artwork: (meta.artwork || []).map((src) => ({ src, sizes: '512x512', type: 'image/png' }))
      })
      const v = document.querySelector('video') as any
      const setHandler = (action: string, fn: () => void) => {
        try {
          nav.mediaSession.setActionHandler(action, fn)
        } catch {
          /* ignore */
        }
      }
      setHandler('play', () => v?.play?.())
      setHandler('pause', () => v?.pause?.())
    } catch {
      /* ignore */
    }
  },
  // 自定义标题栏窗口控制（无边框模式下系统按钮不可见）
  windowMinimize: () => ipcRenderer.invoke('app:windowMinimize'),
  windowToggleMaximize: () => ipcRenderer.invoke('app:windowToggleMaximize'),
  windowClose: () => ipcRenderer.invoke('app:windowClose')
})
