export interface Api {
  loadData(): Promise<any>
  saveData(data: any): Promise<void>
  getProxyUrl(): Promise<string>
  setUpstreamProxy(v: string): Promise<void>
  openFile(): Promise<string | null>
  openJsonFile(): Promise<string | null>
  saveJsonFile(content: string): Promise<{ ok: boolean; error?: string }>
  pickDir(): Promise<string | null>
  download(opts: { url: string; name: string; savePath: string; mergeSegments?: boolean }): Promise<{ ok: boolean; error?: string }>
  onDownloadProgress(cb: (p: { id: string; percent: number; done: boolean }) => void): void
  /** 进入画中画（PiP）；不支持的环境返回 {ok:false, error}（安卓 WebView 降级占位） */
  enterPip(): Promise<{ ok: boolean; error?: string }>
  /** 退出画中画 */
  exitPip(): Promise<void>
  /** 设置媒体会话元数据（安卓 WebView 可借此在通知栏/锁屏显示播放控制） */
  setMediaSession(meta: { title: string; artist?: string; artwork?: string[] }): void
  /** 最小化无边框窗口 */
  windowMinimize(): Promise<void>
  /** 切换最大化 / 还原 */
  windowToggleMaximize(): Promise<void>
  /** 关闭窗口 */
  windowClose(): Promise<void>
}

declare global {
  interface Window {
    api: Api
    __PROXY_URL__?: string
    __resolveProxy__?: () => void
  }
}

export {}
