import type { Api } from './ipc'

/**
 * 平台抽象层：Electron（preload 注入 window.api）与 Capacitor（Android/iOS WebView，本模块实现）共用同一接口。
 *
 * Android 端实现原则【零第三方插件依赖】：
 * - 持久化：localStorage（WebView 跨会话保留，无需 @capacitor/preferences 原生插件）
 * - 分享/导出：navigator.share（Web Share API，Android WebView 原生支持）
 * - 播放：HLS 走 hls.js 直连（MSE）、MP4 原生 video（ExoPlayer），无本地代理
 * 这样 android 工程只需 Capacitor WebView 容器本身，无需任何原生插件，构建链路最短。
 */

// 是否运行在 Capacitor（Android/iOS WebView）环境
export function isCapacitor(): boolean {
  return typeof (window as any)?.Capacitor !== 'undefined'
}

// 读取 Capacitor 原生平台：'ios' | 'android'（'web' 仅作非原生兜底）
function capacitorPlatform(): 'ios' | 'android' | 'web' {
  const cap = (window as any)?.Capacitor
  if (cap && typeof cap.getPlatform === 'function') {
    const p = cap.getPlatform()
    if (p === 'ios' || p === 'android' || p === 'web') return p
  }
  return 'web'
}

// 是否 iOS（WKWebView）
export function isIOS(): boolean {
  return isCapacitor() && capacitorPlatform() === 'ios'
}

// 是否 Android（WebView）
export function isAndroid(): boolean {
  return isCapacitor() && capacitorPlatform() === 'android'
}

// 是否运行在 Electron 环境（preload 注入 window.api）
export function isElectron(): boolean {
  return typeof window.api !== 'undefined' && !isCapacitor()
}

export const PLATFORM: 'electron' | 'android' | 'ios' | 'web' = (() => {
  if (isCapacitor()) return isIOS() ? 'ios' : 'android'
  if (isElectron()) return 'electron'
  return 'web'
})()

// 数据键名（localStorage 存 AppData JSON 于单个 key）
const DATA_KEY = 'mkuaibo.appdata'

// 默认 AppData（与 Electron 主进程 defaultData() 同构，Android 无历史数据时返回，避免渲染层空态）
function defaultData(): any {
  return {
    favorites: [],
    history: {},
    customSources: [],
    playlist: [],
    settings: {
      proxyEnabled: true,
      upstreamProxy: '',
      downloadDir: '',
      theme: 'dark',
      resourceSites: [],
      speedTest: true,
      metaSource: '',
      metaEnabled: false
    }
  }
}

// 微信/QQ 内置浏览器等环境 window.navigator.share 可能不存在 → 回退复制剪贴板
async function webShare(text: string): Promise<boolean> {
  const nav: any = navigator as any
  if (typeof nav?.share === 'function') {
    try {
      await nav.share({ title: 'M快播', text })
      return true
    } catch {
      /* 用户取消分享 */
    }
  }
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

/**
 * Capacitor 版 window.api 实现。
 * 覆盖 Electron preload 暴露的全部接口，Android 不适用的能力降级为安全默认。
 */
export function createCapacitorApi(): Api {
  return {
    async loadData(): Promise<any> {
      try {
        const raw = localStorage.getItem(DATA_KEY)
        if (raw) return JSON.parse(raw)
      } catch (e) {
        console.warn('[cap] loadData failed', e)
      }
      return defaultData()
    },
    async saveData(data: any): Promise<void> {
      try {
        localStorage.setItem(DATA_KEY, JSON.stringify(data))
      } catch (e) {
        console.warn('[cap] saveData failed', e)
      }
    },
    // Android 无本地代理：返回空串，播放器走直连（HLS hls.js MSE / MP4 原生）
    async getProxyUrl(): Promise<string> {
      return ''
    },
    async setUpstreamProxy(): Promise<void> {
      // no-op：Android 无 Node 代理
    },
    // Android 无本地文件打开对话框（播放本地视频用不到）
    async openFile(): Promise<string | null> {
      return null
    },
    // 导入资源站 JSON：通过 <input type=file> 读取
    async openJsonFile(): Promise<string | null> {
      return new Promise((resolve) => {
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = '.json,application/json'
        input.onchange = () => {
          const f = input.files?.[0]
          if (!f) return resolve(null)
          const reader = new FileReader()
          reader.onload = () => resolve(String(reader.result || ''))
          reader.onerror = () => resolve(null)
          reader.readAsText(f)
        }
        input.click()
      })
    },
    // 导出资源站 JSON：系统分享 / 复制剪贴板
    async saveJsonFile(content: string): Promise<{ ok: boolean; error?: string }> {
      const ok = await webShare(content)
      return ok ? { ok: true } : { ok: false, error: '分享不可用' }
    },
    // Android 无"选择目录"
    async pickDir(): Promise<string | null> {
      return null
    },
    // 下载：fetch + Blob + <a download> 触发系统下载；HLS(m3u8) 不支持合并下载（请在线播放）
    async download(opts: { url: string; name: string; savePath: string; mergeSegments?: boolean }): Promise<{ ok: boolean; error?: string }> {
      // iOS WKWebView 不支持 <a download>，无法触发文件落盘 → 优雅降级为「请在线播放」
      if (isIOS()) {
        return { ok: false, error: 'iOS 端暂不支持下载视频，请在线播放' }
      }
      const lower = opts.url.toLowerCase()
      if (lower.includes('.m3u8') || opts.mergeSegments) {
        return { ok: false, error: '安卓端暂不支持 HLS 合并下载，请直接在线播放' }
      }
      try {
        const res = await fetch(opts.url)
        if (!res.ok) return { ok: false, error: 'HTTP ' + res.status }
        const blob = await res.blob()
        // 文件名取自 savePath 的 basename（App 层已含安全标题 + 扩展名），fallback 到 name
        const base = (opts.savePath.split('/').pop() || '').split('\\').pop() || opts.name || 'video'
        const safeBase = base.replace(/[\\/:*?"<>|]/g, '_')
        const fileName = /\.(mp4|webm|mkv|mov|ts|m4v)$/i.test(safeBase) ? safeBase : safeBase + '.mp4'
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = fileName
        document.body.appendChild(a)
        a.click()
        a.remove()
        setTimeout(() => URL.revokeObjectURL(url), 10_000)
        return { ok: true }
      } catch (e: any) {
        return { ok: false, error: String(e?.message || e) }
      }
    },
    onDownloadProgress(_cb: (p: { id: string; percent: number; done: boolean }) => void): void {
      // WebView fetch 无精确进度；由调用方在完成后自行标记（保持接口兼容）
    },
    async windowMinimize(): Promise<void> {},
    async windowToggleMaximize(): Promise<void> {},
    async windowClose(): Promise<void> {},
    // PiP：尝试 HTML 视频画中画；WebView 未开启支持时优雅降级（返回 ok:false 由上层提示）
    async enterPip(): Promise<{ ok: boolean; error?: string }> {
      try {
        const v = document.querySelector('video') as any
        if (!v) return { ok: false, error: '当前没有可画中画的视频' }
        if (!document.pictureInPictureEnabled) {
          return {
            ok: false,
            error: isIOS()
              ? 'iOS 端暂不支持画中画，请在全屏下观看'
              : '安卓端请使用系统多任务键（最近任务）→ 在应用卡片上点「画中画」图标'
          }
        }
        await v.requestPictureInPicture()
        return { ok: true }
      } catch (e: any) {
        return { ok: false, error: String(e?.message || e) }
      }
    },
    async exitPip(): Promise<void> {
      try {
        if (document.pictureInPictureElement) await document.exitPictureInPicture()
      } catch {
        /* no-op */
      }
    },
    // 媒体会话元数据：安卓 WebView 据此在通知栏/锁屏渲染播放控制（无需原生插件）
    setMediaSession(meta: { title: string; artist?: string; artwork?: string[] }): void {
      const nav: any = navigator as any
      if (!nav?.mediaSession) return
      try {
        nav.mediaSession.metadata = new (window as any).MediaMetadata({
          title: meta.title || 'M快播',
          artist: meta.artist || 'M快播',
          artwork: (meta.artwork || []).map((src) => ({ src, sizes: '512x512', type: 'image/png' }))
        })
        // 基础播放控制（锁屏/通知栏 播放/暂停 回写到 video 元素）
        const v = document.querySelector('video') as any
        const setHandler = (action: string, fn: () => void) => {
          try {
            nav.mediaSession.setActionHandler(action, fn)
          } catch {
            /* 部分 WebView 不支持该 action，忽略 */
          }
        }
        setHandler('play', () => v?.play?.())
        setHandler('pause', () => v?.pause?.())
      } catch {
        /* 不支持 MediaSession 时静默降级 */
      }
    }
  }
}

// 确保 window.api 在 Capacitor 环境被注入（Electron 由 preload 注入，无需覆盖）
export function ensurePlatformApi() {
  if (isCapacitor() && !window.api) {
    window.api = createCapacitorApi()
  }
}
