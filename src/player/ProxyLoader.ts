/**
 * 自定义 hls.js Loader：可选走本地代理（用于解决跨域/区域限制）。
 * 从原 Player.tsx 原样迁移，算法逻辑一字不改（ProxyLoader 看门狗/代理转发核心）。
 */

// 代理基地址（由主进程本地代理提供，用于解决跨域/区域限制）
// 注意：PROXY_BASE 由 Player 组件在渲染时按 props 注入（见 Player.tsx），此处仅保留引用约定。
let PROXY_BASE = ''

export function setProxyBase(base: string): void {
  PROXY_BASE = base
}

export function getProxyBase(): string {
  return PROXY_BASE
}

/**
 * 自定义 hls.js Loader。
 * hls.js 要求 loader 实例暴露公开的 stats 属性（LoaderStats 结构）：
 * fragment/initSegment loader 会访问 loader.stats.retry / loader.stats.loading 等，
 * 若缺失（undefined）会抛 "Cannot set properties of undefined (setting 'retry')" → internalException fatal。
 */
export class ProxyLoader {
  private xhr: XMLHttpRequest | null = null
  // hls.js 要求 loader 实例暴露公开的 stats 属性（LoaderStats 结构）：
  // fragment/initSegment loader 会访问 loader.stats.retry / loader.stats.loading 等，
  // 若缺失（undefined）会抛 "Cannot set properties of undefined (setting 'retry')" → internalException fatal。
  stats: any

  constructor() {
    const now = performance.now()
    this.stats = {
      url: '',
      trequest: now,
      tfirst: 0,
      tload: 0,
      loaded: 0,
      total: 0,
      aborted: false,
      retry: 0,
      chunkCount: 0,
      bwEstimate: 0,
      loading: { start: now, first: 0, end: 0 },
      parsing: { start: 0, end: 0 },
      buffering: { start: 0, first: 0, end: 0 }
    }
  }

  load(context: any, _config: any, callbacks: any) {
    const url = PROXY_BASE ? `${PROXY_BASE}/proxy?url=${encodeURIComponent(context.url)}` : context.url
    const xhr = new XMLHttpRequest()
    this.xhr = xhr
    xhr.open('GET', url, true)
    // hls.js 需要同步响应类型；对文本型 m3u8 与二进制 ts 分片分别处理
    if (context.responseType) xhr.responseType = context.responseType
    // Range 处理须与 hls.js 内置 xhr-loader 一致：hls.js 分片请求硬编码 rangeStart=0/rangeEnd=0
    // （普通 TS 分片无 byte-range 需求），若照抄发 bytes=0-0，服务器只回 1 字节 → demuxer 探测失败。
    // 内置 loader 发的是 bytes=start-(end-1)；rangeEnd<=0 时不发 Range（请求全量）。
    if (context.rangeEnd !== undefined && context.rangeEnd > 0) {
      xhr.setRequestHeader('Range', `bytes=${context.rangeStart || 0}-${context.rangeEnd - 1}`)
    }
    if (context.headers) {
      for (const h in context.headers) xhr.setRequestHeader(h, context.headers[h])
    }
    // 复用实例 stats（hls.js 会在请求前后读写它）；每次 load 重置计时字段
    const stats = this.stats
    const now = performance.now()
    stats.url = context.url
    stats.trequest = now
    stats.tfirst = 0
    stats.tload = 0
    stats.loaded = 0
    stats.total = 0
    stats.aborted = false
    stats.retry = 0
    stats.loading = { start: now, first: 0, end: 0 }
    stats.parsing = { start: 0, end: 0 }
    stats.buffering = { start: 0, first: 0, end: 0 }
    xhr.onprogress = (e: ProgressEvent) => {
      // 注意：hls.js 的 LoaderCallbacks.onProgress 是可选回调——仅分片请求提供，
      // manifest/playlist 请求没有 onProgress，直接调用会抛 TypeError 导致加载中断（黑屏根因之一）
      if (typeof callbacks.onProgress !== 'function') return
      stats.loaded = (e as any).loaded
      stats.total = (e as any).total
      callbacks.onProgress({ ...stats }, context)
    }
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        callbacks.onError({ code: xhr.status, text: xhr.statusText || `HTTP ${xhr.status}` }, stats, context, null)
        return
      }
      stats.loaded = xhr.response ? xhr.response.byteLength ?? xhr.response.length : 0
      stats.total = stats.loaded
      stats.tfirst = stats.tfirst || performance.now()
      stats.tload = performance.now()
      // 关键：hls.js 用 onSuccess 返回的 url 作为基准解析清单中的【相对分片路径】。
      // 走代理时 xhr.responseURL 是 http://127.0.0.1:port/proxy?...（本地地址），若用它作基准，
      // 相对路径会被解析成 http://127.0.0.1:port/20260818/xxx → 必然 404/黑屏。
      // 因此优先用主进程回传的 X-Final-URL（重定向跟随后的真实目标 URL），否则回退 context.url（原始请求 URL）。
      const finalUrl = xhr.getResponseHeader('X-Final-URL') || context.url
      callbacks.onSuccess({ url: finalUrl, data: xhr.response, code: xhr.status }, stats, context)
    }
    xhr.onerror = () => callbacks.onError({ code: xhr.status, text: xhr.statusText || 'network error' }, stats, context, null)
    xhr.ontimeout = () => callbacks.onError({ code: xhr.status, text: 'timeout' }, stats, context, null)
    xhr.send()
  }
  abort() {
    if (this.xhr) this.xhr.abort()
  }
  // hls.js 在请求完成后会调用 loader.destroy() 释放资源（缺失会抛 "t.destroy is not a function"）
  destroy() {
    this.abort()
    this.xhr = null
  }
}
