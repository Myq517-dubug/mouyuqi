import { app, BrowserWindow, ipcMain, dialog, protocol, Menu } from 'electron'
import * as http from 'http'
import * as https from 'https'
import * as fs from 'fs'
import * as path from 'path'
import * as url from 'url'
import * as zlib from 'zlib'
import { HttpsProxyAgent } from 'https-proxy-agent'
import { SocksProxyAgent } from 'socks-proxy-agent'

let mainWindow: BrowserWindow | null = null
let proxyPort = 0
// 出口/上游代理：填写后本地代理转发请求会经此代理出网，可解锁海外源
let upstreamProxy = ''

const DATA_DIR = app.getPath('userData')
const DATA_FILE = path.join(DATA_DIR, 'data.json')
const isDev = process.env.VITE_DEV === '1'

// Node http header value 必须是 ISO-8859-1（0x00-0xFF），且不含控制字符（CRLF 会触发 ERR_INVALID_CHAR / header smuggling）。
// 上游（资源站/CDN）偶发非 ASCII / 控制字符的 header，统一清理，保留可读部分。
function safeHeaderValue(v: string): string {
  return v.replace(/[\u0000-\u001F\u007F]/g, '').replace(/[^\x00-\xFF]/g, '')
}

// ---------- 出口代理（本地代理转发时，可经此上游代理出网，解锁海外源）----------
// 把上游响应头整理后回写给客户端；含 Range/流式支持，避免视频等大文件被整包缓存
function buildProxyHeaders(upRes: any, keepLen?: boolean) {
  const out: Record<string, any> = {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS, HEAD',
    'access-control-allow-headers': '*',
    // 允许渲染层 XHR 读取 X-Final-URL（hls.js 解析相对分片路径的基准）
    'access-control-expose-headers': 'X-Final-URL'
  }
  Object.entries(upRes.headers).forEach(([k, v]) => {
    if (v == null) return
    const kl = k.toLowerCase()
    // 上游压缩头不透传；解压后返回明文（或流式解压输出）
    if (kl === 'content-encoding') return
    // content-length 在解压后/Range 场景下需要重写，这里按需保留
    if (kl === 'content-length' && !keepLen) return
    // 透传前 sanitize：避免上游偶发非 ASCII / 控制字符 header 触发 ERR_INVALID_CHAR（x-final-url 同源问题）
    out[k] = Array.isArray(v) ? v.map((x) => safeHeaderValue(String(x))) : safeHeaderValue(String(v))
  })
  return out
}

function pipeProxy(upRes: any, res: any, target?: string) {
  const enc = String(upRes.headers['content-encoding'] || '').toLowerCase()
  const isRange = String(upRes.statusCode || '') === '206' || upRes.headers['content-range']
  // X-Final-URL：本响应对应的最终 URL（重定向跟随后的真实地址）。
  // 渲染层 hls.js 用它解析清单中的相对分片路径；否则会基于本地代理地址解析 → 必然 404/黑屏。
  const finalUrl = target || ''

  // 情况1：上游未压缩，直接流式透传（视频/HLS 分片最佳）
  if (!enc) {
    const out = buildProxyHeaders(upRes, true)
    const safeFinal = safeHeaderValue(finalUrl)
    if (safeFinal) out['x-final-url'] = safeFinal
    res.writeHead(upRes.statusCode || 200, out)
    upRes.pipe(res)
    upRes.on('error', (err: any) => {
      console.error('[proxy] upstream error', err?.message)
      res.destroy?.()
    })
    return
  }

  // 情况2：上游压缩了，需要解压后再输出（无法真正流式，但尽量保留 content-range 信息）
  const chunks: Buffer[] = []
  upRes.on('data', (chunk: Buffer) => chunks.push(chunk))
  upRes.on('end', () => {
    let body = Buffer.concat(chunks)
    try {
      if (enc === 'gzip') body = zlib.gunzipSync(body)
      else if (enc === 'deflate') body = zlib.inflateSync(body)
      else if (enc === 'br') body = zlib.brotliDecompressSync(body)
    } catch (e: any) {
      console.error('[proxy] decompress failed', e?.message)
    }
    const out = buildProxyHeaders(upRes, false)
    const safeFinal = safeHeaderValue(finalUrl)
    if (safeFinal) out['x-final-url'] = safeFinal
    out['content-length'] = body.length
    res.writeHead(upRes.statusCode || 200, out)
    res.end(body)
  })
  upRes.on('error', (err: any) => {
    console.error('[proxy] upstream error', err?.message)
    if (!res.headersSent) {
      res.writeHead(502)
      res.end('upstream error')
    } else {
      res.end()
    }
  })
}

function makeAgent(target: string) {
  if (!upstreamProxy) return null
  const up = new URL(upstreamProxy)
  const t = new URL(target)
  if (up.protocol === 'socks:' || up.protocol === 'socks5:' || up.protocol === 'socks4:') {
    return new SocksProxyAgent(upstreamProxy)
  }
  // http/https 正向代理：https 目标走隧道，http 目标走绝对 URI 形式（见 forward）
  if (t.protocol === 'https:') return new HttpsProxyAgent(upstreamProxy)
  return null
}

function forward(target: string, req: any, res: any, redirects = 0) {
  const t = new URL(target)
  const fwdHeaders: Record<string, any> = { ...req.headers }
  delete fwdHeaders['host']
  delete fwdHeaders['accept-encoding'] // 优先请求明文，减少本地解压；上游仍返回压缩时 pipeProxy 会解压
  fwdHeaders['user-agent'] = (req.headers['user-agent'] as string) || 'Mozilla/5.0'
  // 本地代理请求来自 file:// / app:// / 127.0.0.1，若作为 referer/origin 传给资源站/防盗链 CDN 可能被拒。
  // 改为目标站点自身 origin，模拟从该站点发起的播放请求，绕过基于 Referer/Origin 的防盗链（VLC 能播、浏览器黑屏的根因）。
  fwdHeaders['referer'] = `${t.protocol}//${t.host}/`
  fwdHeaders['origin'] = `${t.protocol}//${t.host}/`
  // 代理主动跟随 3xx 重定向（最多 5 跳）：若透传 302 给 XHR，浏览器会跟随 Location 直连原站，
  // 既绕过代理的 referer/origin 伪装，也可能触发 CORS 失败。跟随后再回传 X-Final-URL 保证相对路径解析正确。
  const handleUpRes = (upRes: any) => {
    if (
      [301, 302, 303, 307, 308].includes(upRes.statusCode) &&
      upRes.headers.location &&
      redirects < 5
    ) {
      upRes.resume() // 释放连接
      const next = new URL(upRes.headers.location, target).toString()
      console.log('[proxy] redirect', upRes.statusCode, '→', next.slice(0, 120))
      forward(next, req, res, redirects + 1)
      return
    }
    pipeProxy(upRes, res, target)
  }
  const up = upstreamProxy ? new URL(upstreamProxy) : null
  // http 目标 + http(s) 上游代理：使用「绝对 URI」正向代理形式
  if (up && (up.protocol === 'http:' || up.protocol === 'https:') && t.protocol === 'http:') {
    const r = http.request(
      {
        host: up.hostname,
        port: Number(up.port) || 80,
        method: req.method,
        path: target,
        headers: { ...fwdHeaders, host: t.host }
      },
      handleUpRes
    )
    r.on('error', () => {
      res.writeHead(502)
      res.end('upstream error')
    })
    req.pipe(r)
    return
  }
  const agent = makeAgent(target)
  const client = t.protocol === 'https:' ? https : http
  const r = client.request(
    target,
    { method: req.method, headers: fwdHeaders, ...(agent ? { agent: agent as any } : {}) },
    handleUpRes
  )
  r.on('error', () => {
    res.writeHead(502)
    res.end('proxy error')
  })
  req.pipe(r)
}

// ---------- 本地代理（解决跨域/区域限制）----------
function createProxy() {
  const server = http.createServer((req, res) => {
    const parsed = url.parse(req.url || '', true)
    if (parsed.pathname === '/proxy') {
      const target = parsed.query.url as string
      if (!target) {
        res.writeHead(400)
        res.end('missing url')
        return
      }
      try {
        new URL(target)
      } catch {
        res.writeHead(400)
        res.end('bad url')
        return
      }
      forward(target, req, res)
      return
    }
    res.writeHead(404)
    res.end()
  })
  server.listen(0, '127.0.0.1', () => {
    proxyPort = (server.address() as any).port
    console.log('[proxy] listening on', proxyPort)
  })
}

// ---------- 数据持久化 ----------
function defaultData() {
  return {
    favorites: [],
    history: {},
    customSources: [],
    playlist: [],
    settings: {
      proxyEnabled: true,
      upstreamProxy: '',
      downloadDir: app.getPath('downloads'),
      theme: 'dark',
      resourceSites: [],
      speedTest: true,
      metaSource: '',
      metaEnabled: false
    }
  }
}

function readData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf-8')
      const parsed = JSON.parse(raw)
      return { ...defaultData(), ...parsed, settings: { ...defaultData().settings, ...parsed.settings } }
    }
  } catch (e) {
    console.error('[data] read error', e)
  }
  return defaultData()
}

function writeData(d: any) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(d, null, 2), 'utf-8')
}

// ---------- 下载（mp4 直链 / m3u8 合并）----------
async function downloadFile(target: string, savePath: string, id: string, sender: any) {
  const r = await fetch(target)
  if (!r.ok || !r.body) throw new Error('下载失败: ' + r.status)
  const total = Number(r.headers.get('content-length') || 0)
  let loaded = 0
  const file = fs.createWriteStream(savePath)
  const reader = r.body.getReader()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) {
      loaded += value.length
      file.write(Buffer.from(value))
      if (total) sender.send('app:download-progress', { id, percent: Math.round((loaded / total) * 100), done: false })
    }
  }
  await new Promise<void>((res) => file.end(res))
  sender.send('app:download-progress', { id, percent: 100, done: true })
}

async function downloadM3u8(target: string, savePath: string, id: string, sender: any) {
  const res = await fetch(target)
  const text = await res.text()
  const base = target.substring(0, target.lastIndexOf('/') + 1)
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  const keys = lines.filter((l) => l.startsWith('#EXT-X-KEY'))
  if (keys.length) throw new Error('该 HLS 已加密，暂不支持下载解密内容')
  const segs: string[] = []
  for (const l of lines) {
    if (l.startsWith('#')) continue
    segs.push(l.startsWith('http') ? l : base + l)
  }
  if (!segs.length) throw new Error('未解析到分片')
  const file = fs.createWriteStream(savePath)
  for (let i = 0; i < segs.length; i++) {
    const buf = Buffer.from(await (await fetch(segs[i])).arrayBuffer())
    file.write(buf)
    sender.send('app:download-progress', {
      id,
      percent: Math.round(((i + 1) / segs.length) * 100),
      done: i === segs.length - 1
    })
  }
  file.end()
}

// ---------- 主窗口 ----------
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    title: 'M快播',
    backgroundColor: '#0e0e10',
    // 隐藏原生标题栏 / 系统菜单栏 / 系统边框，画面顶到屏幕边缘，视频全屏更纯净
    frame: false,
    titleBarStyle: 'hidden',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      // 桌面视频聚合需要加载第三方 m3u8/MP4 直链；关闭同源策略避免 CORS 拦截播放
      webSecurity: false,
      preload: path.join(__dirname, 'preload.js')
    }
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// ---------- 本地文件协议（播放本地视频）----------
app.whenReady().then(() => {
  protocol.registerFileProtocol('local', (request, callback) => {
    const p = decodeURIComponent(request.url.slice('local://'.length))
    callback(p)
  })
  // 完全去掉原生应用菜单（File / Edit / View / Window / Help），避免顶部灰色条
  Menu.setApplicationMenu(null)
  upstreamProxy = readData().settings.upstreamProxy || ''
  createProxy()
  createWindow()

  ipcMain.handle('app:loadData', () => readData())
  ipcMain.handle('app:saveData', (_e, d) => writeData(d))
  ipcMain.handle('app:getProxyUrl', () => (proxyPort ? `http://127.0.0.1:${proxyPort}` : ''))
  ipcMain.handle('app:openFile', async () => {
    const r = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openFile'],
      filters: [{ name: '视频', extensions: ['mp4', 'mkv', 'webm', 'mov', 'm3u8'] }]
    })
    return r.canceled ? null : r.filePaths[0]
  })
  // 导入资源站 JSON：返回文件文本内容（供渲染层解析校验）
  ipcMain.handle('app:openJsonFile', async () => {
    const r = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (r.canceled || !r.filePaths[0]) return null
    try {
      return fs.readFileSync(r.filePaths[0], 'utf-8')
    } catch (e: any) {
      return null
    }
  })
  // 导出资源站 JSON：写入用户选择的文件
  ipcMain.handle('app:saveJsonFile', async (_e, content: string) => {
    const r = await dialog.showSaveDialog(mainWindow!, {
      defaultPath: 'resource-sites.json',
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (r.canceled || !r.filePath) return { ok: false }
    try {
      fs.writeFileSync(r.filePath, content, 'utf-8')
      return { ok: true }
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) }
    }
  })
  ipcMain.handle('app:pickDir', async () => {
    const r = await dialog.showOpenDialog(mainWindow!, { properties: ['openDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  })
  ipcMain.handle('app:download', async (e, opts: { url: string; name: string; savePath: string }) => {
    try {
      const lower = opts.url.toLowerCase()
      if (lower.includes('.m3u8')) {
        await downloadM3u8(opts.url, opts.savePath, opts.name, e.sender)
      } else {
        await downloadFile(opts.url, opts.savePath, opts.name, e.sender)
      }
      return { ok: true }
    } catch (err: any) {
      return { ok: false, error: String(err?.message || err) }
    }
  })
  ipcMain.handle('app:setUpstreamProxy', (_e, v: string) => {
    upstreamProxy = v || ''
  })
  // 无边框窗口自定义控制（最小化 / 最大化 / 关闭）
  ipcMain.handle('app:windowMinimize', () => mainWindow?.minimize())
  ipcMain.handle('app:windowToggleMaximize', () => {
    if (!mainWindow) return
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    else mainWindow.maximize()
  })
  ipcMain.handle('app:windowClose', () => mainWindow?.close())
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
