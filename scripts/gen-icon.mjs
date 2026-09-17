// M快播 程序化图标生成器（纯 Node，零第三方依赖）
// 生成 7 档 PNG（16/24/32/48/64/128/256）内嵌 ICO（PNG-in-ICO，Vista+ 全尺寸），另出 256px PNG。
// 几何图形：品牌红圆角底 + 白色播放三角 + 字母 M 负形（镂空红）。
// 抗锯齿：supersampling（每像素 4×4 采样）+ 手写 PNG（zlib.deflateSync + 手算 CRC32）。
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = join(__dirname, '..', 'build')

// 品牌色
const RED = [230, 57, 70] // #e63946
const WHITE = [255, 255, 255]

// ---------- 几何定义（画布坐标 0..1） ----------
const RECT = { cx: 0.5, cy: 0.5, hw: 0.5, hh: 0.5, r: 0.22 }
const TRI = { a: [0.26, 0.2], b: [0.26, 0.8], c: [0.82, 0.5] } // 指向右侧的播放三角
// M 折线：左下→左上→中间谷底→右上→右下（描边宽度 2*M_HALF）
const M_PTS = [
  [0.32, 0.63],
  [0.32, 0.38],
  [0.435, 0.575],
  [0.55, 0.38],
  [0.55, 0.63]
]
const M_HALF = 0.023 // 描边半宽（画布单位）

function roundedRectInside(x, y, { cx, cy, hw, hh, r }) {
  const dx = Math.abs(x - cx) - (hw - r)
  const dy = Math.abs(y - cy) - (hh - r)
  const ax = Math.max(dx, 0)
  const ay = Math.max(dy, 0)
  return Math.hypot(ax, ay) + Math.min(Math.max(dx, dy), 0) - r <= 0
}

function cross(p1, p2, p3) {
  return (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1])
}
function pointInTriangle(p) {
  const { a, b, c } = TRI
  const d1 = cross(p, a, b)
  const d2 = cross(p, b, c)
  const d3 = cross(p, c, a)
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0
  return !(hasNeg && hasPos)
}

function segDist(px, py, a, b) {
  const abx = b[0] - a[0]
  const aby = b[1] - a[1]
  const apx = px - a[0]
  const apy = py - a[1]
  const len2 = abx * abx + aby * aby
  let t = len2 ? (apx * abx + apy * aby) / len2 : 0
  t = Math.max(0, Math.min(1, t))
  const cx = a[0] + abx * t
  const cy = a[1] + aby * t
  return Math.hypot(px - cx, py - cy)
}
function insideM(px, py) {
  for (let i = 0; i < M_PTS.length - 1; i++) {
    if (segDist(px, py, M_PTS[i], M_PTS[i + 1]) <= M_HALF) return true
  }
  return false
}

// 单个采样点的颜色 [r,g,b,a(0|255)]
function sample(x, y) {
  if (!roundedRectInside(x, y, RECT)) return [0, 0, 0, 0]
  let c = RED
  if (pointInTriangle([x, y])) c = WHITE
  if (insideM(x, y)) c = RED // 负形：M 镂空露出品牌红
  return [c[0], c[1], c[2], 255]
}

// 渲染 size×size RGBA（supersampling 抗锯齿，premultiplied 累加避免暗边）
function render(size, ss = 4) {
  const px = new Uint8Array(size * size * 4)
  const n = ss * ss
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let sr = 0, sg = 0, sb = 0, sa = 0
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const fx = (x + (sx + 0.5) / ss) / size
          const fy = (y + (sy + 0.5) / ss) / size
          const [r, g, b, a] = sample(fx, fy)
          const af = a / 255
          sr += r * af
          sg += g * af
          sb += b * af
          sa += af
        }
      }
      const i = (y * size + x) * 4
      if (sa > 0) {
        px[i] = Math.round(sr / sa)
        px[i + 1] = Math.round(sg / sa)
        px[i + 2] = Math.round(sb / sa)
        px[i + 3] = Math.round((sa / n) * 255)
      }
    }
  }
  return px
}

// ---------- 启动图渲染 ----------
// 品牌深底 + 居中 logo。整屏 2732² 全量超采样在 Node 里太慢，故：
// 1) 背景直接整块填充（纯色，无需采样）；2) 只在 logo 包围盒内做超采样并 alpha 混合。
const SPLASH_BG = [14, 14, 16] // #0e0e10，与 App 深色主题底色一致（避免启动闪白）
const SPLASH_LOGO = 0.22 // logo 边长占画布比例
function renderSplash(size, ss = 3) {
  const px = new Uint8Array(size * size * 4)
  const [br, bg, bb] = SPLASH_BG
  for (let i = 0; i < size * size; i++) {
    px[i * 4] = br
    px[i * 4 + 1] = bg
    px[i * 4 + 2] = bb
    px[i * 4 + 3] = 255
  }
  const S = SPLASH_LOGO
  const o = 0.5 - S / 2
  const lo = Math.max(0, Math.floor(o * size))
  const hi = Math.min(size, Math.ceil((o + S) * size))
  const n = ss * ss
  for (let y = lo; y < hi; y++) {
    for (let x = lo; x < hi; x++) {
      let sr = 0, sg = 0, sb = 0, sa = 0
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const fx = (x + (sx + 0.5) / ss) / size
          const fy = (y + (sy + 0.5) / ss) / size
          // 映射到 logo 本地坐标（0..1）复用同一套品牌几何
          const [r, g, b, a] = sample((fx - o) / S, (fy - o) / S)
          if (a > 0) {
            sr += r
            sg += g
            sb += b
            sa += 1
          }
        }
      }
      if (sa > 0) {
        const cov = sa / n // 该像素的 logo 覆盖率（抗锯齿）
        const i = (y * size + x) * 4
        px[i] = Math.round((sr / sa) * cov + br * (1 - cov))
        px[i + 1] = Math.round((sg / sa) * cov + bg * (1 - cov))
        px[i + 2] = Math.round((sb / sa) * cov + bb * (1 - cov))
      }
    }
  }
  return px
}

// ---------- PNG 编码（手写） ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crc])
}
function encodePng(size, pixels) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  const stride = size * 4
  const raw = Buffer.alloc((stride + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0 // filter: none
    Buffer.from(pixels.buffer, pixels.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1)
  }
  const idat = deflateSync(raw, { level: 9 })
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))])
}

// ---------- ICO 容器 ----------
function encodeIco(entries) {
  const count = entries.length
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(count, 4)
  const dir = Buffer.alloc(16 * count)
  let offset = 6 + dir.length
  const blobs = []
  entries.forEach((e, i) => {
    const o = i * 16
    const w = e.size >= 256 ? 0 : e.size // 256 用 0 表示
    dir[o] = w
    dir[o + 1] = w
    dir[o + 2] = 0 // color count
    dir[o + 3] = 0 // reserved
    dir.writeUInt16LE(1, o + 4) // planes
    dir.writeUInt16LE(32, o + 6) // bit count
    dir.writeUInt32LE(e.png.length, o + 8)
    dir.writeUInt32LE(offset, o + 12)
    blobs.push(e.png)
    offset += e.png.length
  })
  return Buffer.concat([header, dir, ...blobs])
}

// ---------- 生成 ----------
const SIZES = [16, 24, 32, 48, 64, 128, 256]
mkdirSync(OUT_DIR, { recursive: true })

const entries = SIZES.map((size) => ({ size, png: encodePng(size, render(size)) }))
writeFileSync(join(OUT_DIR, 'icon.ico'), encodeIco(entries))
writeFileSync(join(OUT_DIR, 'icon.png'), entries[entries.length - 1].png)

for (const e of entries) {
  console.log(`icon ${e.size}px: ${e.png.length} bytes`)
}
console.log('icon.ico:', statSync(join(OUT_DIR, 'icon.ico')).size, 'bytes')
console.log('icon.png:', statSync(join(OUT_DIR, 'icon.png')).size, 'bytes')

// ---------- iOS App 图标（1024x1024，AppIcon.appiconset 单尺寸 universal） ----------
// 与桌面/安卓共用同一套品牌几何，保证三端图标一致；ios/ 未生成时静默跳过。
try {
  const iosIconDir = join(__dirname, '..', 'ios', 'App', 'App', 'Assets.xcassets', 'AppIcon.appiconset')
  mkdirSync(iosIconDir, { recursive: true })
  const iosIcon = encodePng(1024, render(1024, 4))
  writeFileSync(join(iosIconDir, 'AppIcon-512@2x.png'), iosIcon)
  console.log('ios AppIcon 1024px:', iosIcon.length, 'bytes')
} catch (e) {
  console.log('skip ios AppIcon (ios/ 未生成):', e.message)
}

// ---------- iOS 启动图（品牌深底 + 居中 logo） ----------
// Splash.imageset 的 1x/2x/3x 三槽位指向同名 2732×2732 资源，此处写同一张图。
try {
  const splashDir = join(__dirname, '..', 'ios', 'App', 'App', 'Assets.xcassets', 'Splash.imageset')
  mkdirSync(splashDir, { recursive: true })
  const splash = encodePng(2732, renderSplash(2732))
  for (const name of ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png']) {
    writeFileSync(join(splashDir, name), splash)
  }
  console.log('ios Splash 2732px:', splash.length, 'bytes (x3)')
} catch (e) {
  console.log('skip ios Splash (ios/ 未生成):', e.message)
}
