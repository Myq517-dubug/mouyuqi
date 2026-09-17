/**
 * 播放主组件（Player）。
 * 从原 src/Player.tsx 原样迁移所有交互/算法逻辑（看门狗、StutterGuard、增强、代理切换等），
 * 仅将 ProxyLoader / enhance / stutterGuard 常量 / buildGroups 等抽到 ./player 子模块，
 * 对外默认导出与 v1 完全一致：default as Player。
 */

import { useEffect, useRef, useState, useCallback, useMemo, type MouseEvent as ReactMouseEvent } from 'react'
import Hls from 'hls.js'
import { VideoSource, EnhanceLevel, PlaybackPrefs, AudioMode } from '../types'
import { resolveMediaUrl, sortSourcesByLatency, AUDIO_MODES, AUDIO_LABEL } from '../providers'
import { attachAudioEngine, detachAudioEngine, AudioEngine } from '../audio'
import { isCapacitor, isIOS } from '../platform'
import { ProxyLoader, setProxyBase } from './ProxyLoader'
import { ENHANCE_LEVELS, ENHANCE_LABEL, enhanceFilter, srcTypeLabel } from './enhance'
import { STUTTER_WINDOW_MS, STUTTER_COOLDOWN_MS } from './stutterGuard'
import { SPEED_OPTIONS, QUALITY_RANK, bestIdx, buildGroups } from './controls'

function proxify(url: string, enabled: boolean) {
  return enabled && PROXY_BASE ? `${PROXY_BASE}/proxy?url=${encodeURIComponent(url)}` : url
}

// 代理基地址（由主进程本地代理提供，用于解决跨域/区域限制）
let PROXY_BASE = ''

function fmt(t: number) {
  if (!isFinite(t)) return '0:00'
  const m = Math.floor(t / 60)
  const s = Math.floor(t % 60)
  return `${m}:${s < 10 ? '0' : ''}${s}`
}
function srtToVtt(srt: string) {
  return (
    'WEBVTT\n\n' +
    srt
      .replace(/\r+/g, '')
      .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')
  )
}

interface Props {
  sources: VideoSource[]
  title: string
  proxyEnabled: boolean
  proxyUrl: string
  initialTime?: number
  playback?: PlaybackPrefs
  onProgress?: (cur: number, dur: number) => void
  onSourceFail?: () => void
  onPlaybackChange?: (p: PlaybackPrefs) => void
  /** 轻量提示通道（安卓 PiP 不支持等场景） */
  onToast?: (msg: string) => void
}

export default function Player({
  sources,
  title,
  proxyEnabled,
  proxyUrl,
  initialTime = 0,
  playback,
  onProgress,
  onSourceFail,
  onPlaybackChange,
  onToast
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const hlsRef = useRef<any>(null)
  // 初始 idx：优先使用持久化的 lastSourceIdx（且该源仍存在），否则选最快可达
  const initialIdx = useMemo(() => {
    const saved = playback?.lastSourceIdx
    if (saved != null && sources[saved]) return saved
    return bestIdx(sources)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sources])
  const [idx, setIdxRaw] = useState<number>(initialIdx)
  const [playing, setPlaying] = useState(false)
  const [cur, setCur] = useState(0)
  const [dur, setDur] = useState(0)
  const [speed, setSpeed] = useState<number>(playback?.speed ?? 1)
  const [vol, setVol] = useState(1)
  const [badge, setBadge] = useState('')
  const [srcErr, setSrcErr] = useState<Record<number, string>>({})
  // 播放层是否走本地代理：与搜索代理解耦，优先尝试直连，失败再 fallback 到代理
  // 默认勾选 = playback.proxyByDefault 缺省 true（含历史用户），不再跟随全局 proxyEnabled
  const [useProxyForPlay, setUseProxyForPlay] = useState<boolean>(playback?.proxyByDefault !== false)
  // 用户显式代理偏好（与运行时切换解耦：看门狗/StutterGuard 改路不覆盖用户偏好）
  // v3（Bug1 加固）：checkbox 展示 proxyPref（用户偏好态）而非运行时模式——运行时自动改路
  // （如「代理失败，尝试直连」）不再把勾选顶掉，保证「默认勾选且只能手动取消」；
  // 实际播放模式的变化通过 badge 提示。
  const [proxyPref, setProxyPref] = useState<boolean>(playback?.proxyByDefault !== false)
  const proxyPrefRef = useRef<boolean>(playback?.proxyByDefault !== false)
  // v3（UX）：手动/自动切源时顶部浮层提示「正在切换 → 线路X」
  const [switchToast, setSwitchToast] = useState('')
  const switchToastTimer = useRef<any>(null)
  const showSwitchToast = useCallback((text: string) => {
    setSwitchToast(text)
    if (switchToastTimer.current) clearTimeout(switchToastTimer.current)
    switchToastTimer.current = setTimeout(() => setSwitchToast(''), 1800)
  }, [])
  useEffect(() => {
    return () => {
      if (switchToastTimer.current) clearTimeout(switchToastTimer.current)
    }
  }, [])
  // v3（UX）：进度条悬停/拖动时显示时间 tooltip
  const [progTip, setProgTip] = useState<{ x: number; t: number } | null>(null)
  const [logs, setLogs] = useState<string[]>([])
  // 画质增强档位：关/轻/中/强，默认「轻」
  const [enhance, setEnhance] = useState<EnhanceLevel>(playback?.enhance ?? 'light')
  // 音频档位（杜比/空间/低音/原声），缺省「原声」
  const [audioMode, setAudioMode] = useState<AudioMode>(playback?.audioMode ?? 'original')
  const [audioOpen, setAudioOpen] = useState(false)
  // 记录每个源已经尝试过的播放模式，避免无限来回切换
  const triedRef = useRef<Record<number, ('direct' | 'proxy')[]>>({})
  // HLS manifest 解析后回填的高度（用于清晰度识别，T05）
  const [heights, setHeights] = useState<Record<number, number>>({})
  // 源分组折叠状态（仅会话级，不持久化）
  const [collapsedMap, setCollapsedMap] = useState<Record<string, boolean>>({})
  // 续播目标时间：首次 = initialTime；切源前记录当前时间；手动切源走相同路径
  const seekRef = useRef<number>(initialTime)
  // 卡顿切源：已尝试源索引去重
  const triedSourcesRef = useRef<number[]>([])
  // 卡顿状态机
  const stutterRef = useRef<{ stallSince: number; lastSwitchAt: number; timer: any }>({
    stallSince: 0,
    lastSwitchAt: 0,
    timer: null
  })
  // 控制条显隐
  const [controlsVisible, setControlsVisible] = useState(false)
  const hideTimerRef = useRef<any>(null)
  // 倍速下拉浮层
  const [speedOpen, setSpeedOpen] = useState(false)
  // 选集侧栏
  const [sourceSidebar, setSourceSidebar] = useState(false)
  // 音频效果链（挂载一次；切源/切集不重建）
  const audioRef = useRef<AudioEngine | null>(null)

  // ---------- 控制条显隐状态机（三路触发：hover / 点击画面空白 / Ctrl+Shift+C） ----------
  const showControls = useCallback(() => {
    setControlsVisible(true)
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current)
      hideTimerRef.current = null
    }
  }, [])
  const scheduleHide = useCallback(() => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
    hideTimerRef.current = setTimeout(() => {
      setControlsVisible(false)
      hideTimerRef.current = null
    }, 3000) // v3：对齐 PRD/设计文档的 3s（原 2s 与文档表述不一致）
  }, [])
  // 镜像 state，供空依赖键盘 handler 读取当前显隐态（避免闭包 stale）
  const controlsVisibleRef = useRef(controlsVisible)
  useEffect(() => {
    controlsVisibleRef.current = controlsVisible
  }, [controlsVisible])
  const toggleControls = useCallback(() => {
    if (controlsVisibleRef.current) {
      // 显示中：立即隐藏
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current)
        hideTimerRef.current = null
      }
      setControlsVisible(false)
    } else {
      // 隐藏中：显示并重置 3s 计时
      showControls()
      scheduleHide()
    }
  }, [showControls, scheduleHide])
  // 点击画面空白切换：内部控件（控制条/选集栏/倍速菜单/音频菜单）点击不触发
  const toggleOnBlank = useCallback(
    (e: ReactMouseEvent) => {
      const t = e.target as HTMLElement
      if (t.closest('.controls-overlay,.src-sidebar,.speed-menu,.audio-menu')) return
      toggleControls()
    },
    [toggleControls]
  )

  setProxyBase(proxyUrl)
  PROXY_BASE = proxyEnabled ? proxyUrl : ''

  // 包装 setIdx：手动切源走此，续播当前位置 + 清空「已尝试源」（允许新一轮自动切源）
  const switchTo = useCallback(
    (next: number) => {
      if (next === idx) return
      const v = videoRef.current
      if (v && v.currentTime > 0) seekRef.current = v.currentTime
      triedSourcesRef.current = []
      stutterRef.current.stallSince = 0
      if (stutterRef.current.timer) {
        clearTimeout(stutterRef.current.timer)
        stutterRef.current.timer = null
      }
      showSwitchToast(`正在切换 → 线路${next + 1}`)
      setIdxRaw(next)
    },
    [idx, showSwitchToast]
  )

  // 持久化：倍速/增强档/当前源索引/代理默认勾选/音频档位（整体提交，防覆盖式写入丢字段）
  const onPlaybackChangeRef = useRef(onPlaybackChange)
  onPlaybackChangeRef.current = onPlaybackChange
  useEffect(() => {
    onPlaybackChangeRef.current?.({
      speed,
      enhance,
      lastSourceIdx: idx,
      proxyByDefault: proxyPrefRef.current,
      audioMode
    })
  }, [speed, enhance, idx, audioMode])

  // 音频效果链：挂载时一次 createMediaElementSource；切源/切集不重建；
  // 卸载延迟释放（防 StrictMode 双挂载误杀，见 audio.ts detachAudioEngine）
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    // Android：原生 <video> 播放（ExoPlayer），createMediaElementSource 会干扰/无声，
    // 杜比/空间音频在安卓暂禁用（不挂载音频引擎，界面同步隐藏音频按钮）
    if (isCapacitor()) return
    const engine = attachAudioEngine(video)
    audioRef.current = engine
    const mode = playback?.audioMode ?? 'original'
    if (engine) {
      // 恢复持久化档位（跳过防抖立即生效）
      if (mode !== 'original') engine.setModeNow(mode, video.volume || 1)
      engine.resume()
    }
    return () => {
      audioRef.current = null
      detachAudioEngine(video)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // 首次播放（用户手势）恢复 AudioContext
  useEffect(() => {
    if (playing) audioRef.current?.resume()
  }, [playing])
  // 音频菜单点外部关闭
  useEffect(() => {
    if (!audioOpen) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement
      if (!t.closest('.audio-menu, .audio-btn')) setAudioOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [audioOpen])

  const switchSource = useCallback(
    (delta: number) => {
      const next = (idx + delta + sources.length) % sources.length
      switchTo(next)
    },
    [idx, sources.length, switchTo]
  )

  // 当前源测速失败(-1)时，自动切到最快可达源（不干扰手动选择）
  useEffect(() => {
    const cur = sources[idx]
    if (cur && cur.speed === -1) {
      const bi = bestIdx(sources)
      if (bi !== idx && (sources[bi]?.speed ?? -1) >= 0) {
        // 复用 switchTo 以续播 + 清空 triedSources
        switchTo(bi)
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sources, idx])

  // 切源时重置该源的尝试记录
  useEffect(() => {
    triedRef.current[idx] = []
  }, [sources, idx])

  // 加载当前源
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const src = sources[idx]
    if (!src) return
    setBadge('加载中…')
    setSrcErr((prev) => {
      const p = { ...prev }
      delete p[idx]
      return p
    })
    setLogs([])
    let cancelled = false
    if (hlsRef.current) {
      hlsRef.current.destroy()
      hlsRef.current = null
    }
    const nativeHls = video.canPlayType('application/vnd.apple.mpegurl')
    // canPlayType 对 HLS 在 Chromium/Electron 上不可靠（可能返回 'maybe' 却根本不能解复用）。
    // 仅真正的 Safari 才信任原生 HLS；Electron/Chromium 一律走 hls.js，绝不把 m3u8 直塞 video.src（否则必 VIDEO_ERR_4）。
    const isSafari = /Safari/i.test(navigator.userAgent) && !/Chrome/i.test(navigator.userAgent) && !/Electron/i.test(navigator.userAgent)

    const pushLog = (msg: string) => {
      console.log('[player]', msg)
      setLogs((prev) => [...prev.slice(-4), msg])
    }

    // 看门狗：某些站点（防盗链/Referer 校验）在直连或代理下会"加载成功但不出画面、无报错"。
    // 若清单已解析但迟迟没有分片/没有出帧，自动切换另一种模式（直连↔代理）。
    let watchdogTimer: any = null
    const clearWatchdog = () => {
      if (watchdogTimer) {
        clearTimeout(watchdogTimer)
        watchdogTimer = null
      }
    }
    const startWatchdog = (ms: number, label: string) => {
      clearWatchdog()
      watchdogTimer = setTimeout(() => {
        const v = videoRef.current
        if (!v) return
        // readyState < 2 表示媒体元素从未拿到可渲染数据 → 源本身未能播放，而非自动播放被拦截
        if (v.readyState < 2) {
          const tried = triedRef.current[idx] || []
          const next =
            !useProxyForPlay && proxyEnabled && !tried.includes('proxy')
              ? 'proxy'
              : useProxyForPlay && !tried.includes('direct')
              ? 'direct'
              : null
          if (next === 'proxy') {
            triedRef.current[idx] = [...tried, 'proxy']
            if (v && v.currentTime > 0) seekRef.current = v.currentTime
            setUseProxyForPlay(true)
            setBadge('直连未出画面，改走本地代理')
            pushLog(`${label}: direct no playback → proxy`)
          } else if (next === 'direct') {
            triedRef.current[idx] = [...tried, 'direct']
            if (v && v.currentTime > 0) seekRef.current = v.currentTime
            setUseProxyForPlay(false)
            setBadge('代理未出画面，改直连')
            pushLog(`${label}: proxy no playback → direct`)
          }
        }
      }, ms)
    }
    const onVideoError = () => {
      const err = video.error
      const text = err ? `VIDEO_ERR_${err.code}` : 'unknown video error'
      setSrcErr((prev) => ({ ...prev, [idx]: text }))
      setBadge('播放失败：' + text)
      pushLog(`video error: ${text}`)
    }

    // ---------- 卡顿切源（StutterGuard） ----------
    const clearStall = () => {
      stutterRef.current.stallSince = 0
      if (stutterRef.current.timer) {
        clearTimeout(stutterRef.current.timer)
        stutterRef.current.timer = null
      }
    }
    const triggerStutterSwitch = () => {
      const now = performance.now()
      if (now - stutterRef.current.lastSwitchAt < STUTTER_COOLDOWN_MS) return
      stutterRef.current.lastSwitchAt = now
      // 1) 同源直连 ↔ 代理（沿用 triedRef，避免无限来回切换）
      const tried = triedRef.current[idx] || []
      if (!useProxyForPlay && proxyEnabled && !tried.includes('proxy')) {
        triedRef.current[idx] = [...tried, 'proxy']
        const v = videoRef.current
        if (v && v.currentTime > 0) seekRef.current = v.currentTime
        setUseProxyForPlay(true)
        setBadge('卡顿，切换本地代理')
        pushLog('stutter → proxy')
        return
      }
      if (useProxyForPlay && !tried.includes('direct')) {
        triedRef.current[idx] = [...tried, 'direct']
        const v = videoRef.current
        if (v && v.currentTime > 0) seekRef.current = v.currentTime
        setUseProxyForPlay(false)
        setBadge('卡顿，切换直连')
        pushLog('stutter → direct')
        return
      }
      // 2) 跨源：按延迟升序切到未尝试过的源
      const candidates = sortSourcesByLatency(sources, triedSourcesRef.current)
      const next = candidates.find((i) => i !== idx && !triedSourcesRef.current.includes(i))
      if (next != null && next !== undefined) {
        const v = videoRef.current
        if (v && v.currentTime > 0) seekRef.current = v.currentTime
        triedSourcesRef.current = [...triedSourcesRef.current, idx]
        setBadge(`卡顿，自动切换线路 → ${next + 1}`)
        showSwitchToast(`卡顿，自动切换 → 线路${next + 1}`)
        pushLog(`stutter → source #${next}`)
        setIdxRaw(next)
      } else {
        setBadge('该片所有源暂不可用')
        pushLog('stutter: all sources exhausted')
      }
    }
    const startStallTimer = () => {
      const now = performance.now()
      if (!stutterRef.current.stallSince) stutterRef.current.stallSince = now
      if (stutterRef.current.timer) clearTimeout(stutterRef.current.timer)
      const elapsed = now - stutterRef.current.stallSince
      const delay = Math.max(50, STUTTER_WINDOW_MS - elapsed)
      stutterRef.current.timer = setTimeout(() => {
        stutterRef.current.timer = null
        stutterRef.current.stallSince = 0
        triggerStutterSwitch()
      }, delay)
    }
    const onStall = () => startStallTimer()
    const onRecover = () => clearStall()

    // 真正开始播放：playUrl/type 来自 resolveMediaUrl 解析结果（播放页 → 真实 HLS/MP4 地址）
    const startPlayback = (playUrl: string, type: 'hls' | 'mp4') => {
      // 视频级事件：用于卡顿检测
      video.addEventListener('stalled', onStall)
      video.addEventListener('waiting', onStall)
      video.addEventListener('playing', onRecover)
      video.addEventListener('loadedmetadata', () => {
        clearWatchdog()
        clearStall()
      })
      video.addEventListener('playing', clearWatchdog)
      video.addEventListener('error', onVideoError)
      // 续播目标：切源前记录的 seekRef，或首次的 initialTime
      const seekTime = seekRef.current
      // Android：HLS 与 MP4 都原生播放——WebView 的 <video> 底层走系统 ExoPlayer，
      // 原生支持 HLS(m3u8)，且 <video> 媒体请求不受 CORS 限制（hls.js 的 XHR 会被拦截）。
      if (isCapacitor()) {
        video.src = playUrl
        video.load()
        if (seekTime > 0) video.currentTime = seekTime
        video.play().catch(() => {})
        startWatchdog(10000, 'native-android')
        pushLog(`android native play(${type}): ${playUrl.slice(0, 80)}...`)
        return
      }
      if (type === 'hls') {
        // 对 .m3u8 一律优先 hls.js：Chromium 的 canPlayType 对 HLS 不可靠，
        // 若误判为"原生支持"而直接 video.src=<m3u8>，必触发 VIDEO_ERR_4(SRC_NOT_SUPPORTED)。
        if (Hls.isSupported()) {
          const hls = new Hls({
            // Android 无本地代理：永远用 hls.js 默认 loader 直连（MSE 播放）；
            // 桌面端按 useProxyForPlay 决定是否挂本地代理 loader
            loader: !isCapacitor() && useProxyForPlay ? (ProxyLoader as any) : undefined,
            enableWorker: false, // Electron 打包后 worker 路径可能异常，禁用避免潜在问题
            debug: false
          })
          hlsRef.current = hls
          hls.loadSource(playUrl)
          hls.attachMedia(video)
          pushLog(`load source ${useProxyForPlay ? '(proxy)' : '(direct)'} [hls.js]: ${playUrl.slice(0, 80)}...`)
          hls.on(Hls.Events.MANIFEST_PARSED, (_e: any, data: any) => {
            const lvls = data.levels || []
            // 清晰度识别（T05）：取最大 height 写入该源
            const maxH = lvls.length ? Math.max(...lvls.map((l: any) => Number(l.height) || 0)) : 0
            if (maxH > 0) {
              setHeights((prev) => ({ ...prev, [idx]: maxH }))
            }
            pushLog(`manifest parsed: ${lvls.length} levels, maxH=${maxH || '?'}`)
            setBadge('')
            if (seekTime > 0) video.currentTime = seekTime
            video.play().catch(() => {})
            // 清单已拿到但迟迟不出分片 → 看门狗自动切换模式
            startWatchdog(8000, 'hls')
          })
          hls.on(Hls.Events.LEVEL_LOADED, (_e: any, data: any) => {
            pushLog(`level loaded: ${data.details?.totalduration?.toFixed(1) || 0}s`)
          })
          hls.on(Hls.Events.FRAG_LOADED, (_e: any, data: any) => {
            if (data.frag?.type === 'main') {
              setBadge('缓冲中…')
              clearWatchdog() // 已拿到首个分片，源确属可用，取消看门狗
            }
          })
          hls.on(Hls.Events.ERROR, (_e: any, data: any) => {
            const detail = data.response?.code || data.details || data.type || 'unknown'
            pushLog(`error: ${data.type}/${detail}`)
            // 卡顿类非致命错误 → 启动卡顿窗口
            if (!data.fatal) {
              setSrcErr((prev) => ({ ...prev, [idx]: detail }))
              const d = String(data.details || '')
              if (
                d === 'bufferStalledError' ||
                d === 'bufferNudgeOnStall' ||
                d === 'fragLoadTimeout' ||
                d === 'fragLoadingError' ||
                d === 'levelLoadTimeout'
              ) {
                startStallTimer()
              }
              return
            }
            setSrcErr((prev) => ({ ...prev, [idx]: detail }))
            const tried = triedRef.current[idx] || []
            // 致命错误：优先切换 直连↔代理（覆盖网络错误、清单解析失败、防盗链 403 等）
            if (!useProxyForPlay && proxyEnabled && !tried.includes('proxy')) {
              triedRef.current[idx] = [...tried, 'proxy']
              const v = videoRef.current
              if (v && v.currentTime > 0) seekRef.current = v.currentTime
              setUseProxyForPlay(true)
              setBadge('当前模式失败，尝试本地代理')
              pushLog(`fatal ${detail} → proxy`)
            } else if (useProxyForPlay && !tried.includes('direct')) {
              triedRef.current[idx] = [...tried, 'direct']
              const v = videoRef.current
              if (v && v.currentTime > 0) seekRef.current = v.currentTime
              setUseProxyForPlay(false)
              setBadge('代理失败，尝试直连')
              pushLog(`fatal ${detail} → direct`)
            } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
              setBadge('解码错误，尝试恢复')
              hls.recoverMediaError()
            } else if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
              // 网络错误：若同源「代理 + 直连」两种模式都已尝试仍失败，
              // 不再 hls.startLoad() 无限重试（会造成代理↔直连死循环卡死），
              // 改为按延迟升序切到下一个未尝试的源。
              const triedModes = triedRef.current[idx] || []
              const bothTried = triedModes.includes('proxy') && triedModes.includes('direct')
              const candidates = sortSourcesByLatency(sources, triedSourcesRef.current)
              const next = candidates.find((i) => i !== idx && !triedSourcesRef.current.includes(i))
              if (bothTried && next != null && next !== undefined) {
                const v = videoRef.current
                if (v && v.currentTime > 0) seekRef.current = v.currentTime
                triedSourcesRef.current = [...triedSourcesRef.current, idx]
                setBadge(`线路${idx + 1} 不可用，切换 → 线路${next + 1}`)
                showSwitchToast(`切换 → 线路${next + 1}`)
                pushLog(`network error, both modes tried → source #${next}`)
                setIdxRaw(next)
              } else {
                setBadge('网络错误，尝试恢复')
                hls.startLoad()
              }
            } else {
              setBadge('该源不可用，自动切换')
              showSwitchToast(`该源不可用，切换 → 线路${(idx + 1) % sources.length + 1}`)
              switchSource(1)
              onSourceFail?.()
            }
          })
          // hls.js 分支也监听 video 元素级错误（如编解码不支持 VIDEO_ERR_4），便于诊断与恢复
          // （error 监听已在 startPlayback 开头统一注册，避免重复）
        } else if (nativeHls && isSafari) {
          // 仅真正的 Safari 才用原生 video.src；Electron/Chromium 永不直塞 m3u8（否则 VIDEO_ERR_4）
          video.src = proxify(playUrl, useProxyForPlay)
          startWatchdog(10000, 'native-hls')
          if (seekTime > 0) video.currentTime = seekTime
          video.play().catch(() => {})
          pushLog('branch: native-hls (Safari)')
        } else {
          setBadge('当前环境不支持 HLS 播放')
          setSrcErr((prev) => ({ ...prev, [idx]: 'HLS_NOT_SUPPORTED' }))
          pushLog(`branch: hls not supported (isSupported=${Hls.isSupported()}, nativeHls=${JSON.stringify(nativeHls)})`)
        }
      } else {
        video.src = proxify(playUrl, useProxyForPlay)
        video.load()
        if (seekTime > 0) video.currentTime = seekTime
        video.play().catch(() => {})
        startWatchdog(10000, 'native')
      }
    }

    // 加载源：先解析播放页/真实地址，再开始播放
    void (async () => {
      const resolved = await resolveMediaUrl(src.url, useProxyForPlay, PROXY_BASE)
      if (cancelled) return
      if (resolved.url !== src.url) {
        pushLog(`解析播放页 → ${resolved.type}: ${resolved.url.slice(0, 90)}`)
      }
      startPlayback(resolved.url, resolved.type)
    })()

    return () => {
      cancelled = true
      clearWatchdog()
      clearStall()
      video.removeEventListener('error', onVideoError)
      video.removeEventListener('playing', clearWatchdog)
      video.removeEventListener('loadedmetadata', clearWatchdog)
      video.removeEventListener('stalled', onStall)
      video.removeEventListener('waiting', onStall)
      video.removeEventListener('playing', onRecover)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sources, idx, proxyEnabled, proxyUrl, useProxyForPlay])

  // 播放进度 / 续播上报
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const onTime = () => {
      setCur(video.currentTime)
      setDur(video.duration || 0)
      onProgress?.(video.currentTime, video.duration || 0)
    }
    const onMeta = () => setDur(video.duration || 0)
    const onPlay = () => setPlaying(true)
    const onPause = () => setPlaying(false)
    video.addEventListener('timeupdate', onTime)
    video.addEventListener('loadedmetadata', onMeta)
    video.addEventListener('play', onPlay)
    video.addEventListener('pause', onPause)
    return () => {
      video.removeEventListener('timeupdate', onTime)
      video.removeEventListener('loadedmetadata', onMeta)
      video.removeEventListener('play', onPlay)
      video.removeEventListener('pause', onPause)
    }
  }, [onProgress])

  // 倍速同步到 video
  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = speed
  }, [speed])

  // 快捷键
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const v = videoRef.current
      if (!v) return
      // 快捷键：Ctrl+Shift+C 切换控制条显隐（读 ref 镜像，无 stale 闭包问题）
      if (e.ctrlKey && e.shiftKey && (e.key === 'C' || e.key === 'c')) {
        e.preventDefault()
        toggleControls()
        return
      }
      switch (e.key) {
        case ' ':
          e.preventDefault()
          v.paused ? v.play() : v.pause()
          break
        case 'ArrowLeft':
          v.currentTime = Math.max(0, v.currentTime - 5)
          break
        case 'ArrowRight':
          v.currentTime = Math.min(v.duration || 0, v.currentTime + 5)
          break
        case 'ArrowUp':
          v.volume = Math.min(1, v.volume + 0.1)
          setVol(v.volume)
          break
        case 'ArrowDown':
          v.volume = Math.max(0, v.volume - 0.1)
          setVol(v.volume)
          break
        case 'f':
        case 'F':
          void toggleFullscreen()
          break
        case 'm':
        case 'M':
          v.muted = !v.muted
          break
        case 'p':
        case 'P':
          window.api.enterPip()
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // 首次播放：自动显示 3s 后隐藏
  useEffect(() => {
    if (playing) {
      showControls()
      scheduleHide()
    }
  }, [playing, showControls, scheduleHide])

  const seek = (v: number) => {
    const video = videoRef.current
    if (video) video.currentTime = v
  }
  const togglePiP = async () => {
    const r = await window.api.enterPip()
    if (!r.ok && onToast) onToast(r.error || '画中画不可用')
  }

  // U7：全屏时自动横屏（manifest 已放开 fullSensor，App 启动时 JS 锁 portrait；
  // 进全屏先 unlock 再 lock('landscape')，退出全屏 lock('portrait') 恢复竖屏）
  const toggleFullscreen = async () => {
    const v = videoRef.current
    if (!v) return
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen()
        try {
          await (screen.orientation as any).lock?.('portrait')
        } catch {
          /* noop */
        }
      } else {
        // iOS WKWebView 不支持 video.requestFullscreen()，走原生 webkitEnterFullscreen
        // （进入系统播放器全屏，自动横屏；退出由系统播放器 UI 负责）
        const anyV = v as any
        if (isIOS() && typeof anyV.webkitEnterFullscreen === 'function') {
          anyV.webkitEnterFullscreen()
          return
        }
        await v.requestFullscreen()
        try {
          await (screen.orientation as any).unlock?.()
        } catch {
          /* noop */
        }
        try {
          await (screen.orientation as any).lock?.('landscape')
        } catch {
          /* WebView 不支持 orientation lock 时忽略（可手动旋转） */
        }
      }
    } catch {
      /* noop */
    }
  }

  // P2-3：上报媒体会话元数据（安卓 WebView 据此在通知栏/锁屏显示播放控制，无需原生插件）
  useEffect(() => {
    if (title) window.api.setMediaSession({ title, artist: 'M快播' })
  }, [title])
  const loadSubtitle = async (file: File) => {
    const v = videoRef.current
    if (!v) return
    const text = await file.text()
    const vtt = file.name.endsWith('.vtt') ? text : srtToVtt(text)
    const blob = new Blob([vtt], { type: 'text/vtt' })
    const url = URL.createObjectURL(blob)
    // 清除旧 track
    Array.from(v.querySelectorAll('track')).forEach((t) => t.remove())
    const track = document.createElement('track')
    track.kind = 'subtitles'
    track.src = url
    track.srclang = 'zh'
    track.label = '字幕'
    track.default = true
    v.appendChild(track)
    setTimeout(() => {
      if (v.textTracks[0]) v.textTracks[0].mode = 'showing'
    }, 200)
  }

  // 源分组（按 清晰度 × 格式 二维折叠）
  const groups = useMemo(
    () => buildGroups(sources, heights, collapsedMap),
    [sources, heights, collapsedMap]
  )
  const toggleGroup = (key: string) => {
    setCollapsedMap((m) => ({ ...m, [key]: !(m[key] != null ? m[key] : groups.find((g) => g.key === key)?.collapsed) }))
  }
  const setSpeedVal = (s: number) => {
    setSpeed(s)
    setSpeedOpen(false)
  }
  const applyEnhance = (l: EnhanceLevel) => {
    setEnhance(l)
  }
  // 音频档位切换：即时高亮 + 持久化（走 persist effect 的 audioMode dep）+ 引擎切档
  const pickAudioMode = (m: AudioMode) => {
    setAudioMode(m)
    setAudioOpen(false)
    const engine = audioRef.current
    const v = videoRef.current
    engine?.setMode(m, v?.volume ?? 1)
    engine?.resume()
  }

  return (
    <div>
      {/* 画质增强用 SVG 锐化滤镜定义（仅被 <video> 的 filter:url(#...) 引用，不参与播放数据流） */}
      <svg width="0" height="0" style={{ position: 'absolute', width: 0, height: 0 }} aria-hidden="true" focusable="false">
        <defs>
          <filter id="m-enhance-sharpen" x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
            <feConvolveMatrix order="3" preserveAlpha="true" kernelMatrix="0 -0.15 0 -0.15 1.6 -0.15 0 -0.15 0" />
          </filter>
          <filter id="m-enhance-sharpen-strong" x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
            <feConvolveMatrix order="3" preserveAlpha="true" kernelMatrix="0 -0.25 0 -0.25 2 -0.25 0 -0.25 0" />
          </filter>
        </defs>
      </svg>

      <div className="player-wrap">
        <div
          className="video-box"
          onMouseEnter={showControls}
          onMouseLeave={scheduleHide}
          onMouseMove={() => {
            // v3（遗留#2）：悬停不动也按 3s 自动隐藏（原实现鼠标停在画面上控制条永不消失）
            showControls()
            scheduleHide()
          }}
          onClick={toggleOnBlank}
        >
          {/* Android：不挂 crossOrigin（否则媒体请求走 CORS 模式，无 ACAO 头即失败；原生播放需裸请求） */}
          <video
            ref={videoRef}
            playsInline
            {...(isCapacitor() ? {} : { crossOrigin: 'anonymous' as const })}
            style={{ filter: enhanceFilter(enhance) }}
          />

          {/* 全屏毛玻璃控制条（T03） */}
          <div className={'controls-overlay' + (controlsVisible ? ' visible' : '')}>
            <div className="row">
              <button
                className="btn sm"
                onClick={() => (videoRef.current?.paused ? videoRef.current.play() : videoRef.current?.pause())}
                title="播放/暂停（空格）"
              >
                {playing ? '暂停' : '播放'}
              </button>
              <span className="time-pill">{fmt(cur)} / {fmt(dur)}</span>
              <button className="btn sm" onClick={() => seek(Math.max(0, cur - 10))} title="快退 10s">«10</button>
              <div className="prog-wrap">
                <input
                  className="ctl-progress"
                  type="range"
                  min={0}
                  max={dur || 0}
                  step={0.1}
                  value={cur}
                  onChange={(e) => seek(Number(e.target.value))}
                  onMouseMove={(e) => {
                    const r = e.currentTarget.getBoundingClientRect()
                    if (!r.width) return
                    const ratio = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
                    setProgTip({ x: ratio, t: ratio * (dur || 0) })
                  }}
                  onMouseLeave={() => setProgTip(null)}
                  title="进度"
                />
                {progTip && dur > 0 && (
                  <div className="prog-tip" style={{ left: `${progTip.x * 100}%` }}>
                    {fmt(progTip.t)}
                  </div>
                )}
              </div>
              <button className="btn sm" onClick={() => seek(Math.min(dur, cur + 10))} title="快进 10s">10»</button>
              <div className="speed-dd" onMouseLeave={() => setSpeedOpen(false)}>
                <button className="seg-btn" onClick={() => setSpeedOpen((v) => !v)} title="倍速">
                  {speed}x ▾
                </button>
                {speedOpen && (
                  <div className="speed-menu" role="menu">
                    {SPEED_OPTIONS.map((s) => (
                      <button
                        key={s}
                        className={'speed-item' + (speed === s ? ' active' : '')}
                        onClick={() => setSpeedVal(s)}
                      >
                        {s}x
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {/* 杜比 ♫ 音频档位菜单（T02 P0-3）；安卓原生播放不支持音频引擎，隐藏 */}
              {!isCapacitor() && (
                <div className="audio-dd" onMouseLeave={() => setAudioOpen(false)}>
                  <button className="btn sm audio-btn" onClick={() => setAudioOpen((v) => !v)} title="音频模式">
                    杜比 ♫ ▾
                  </button>
                  {audioOpen && (
                    <div className="audio-menu" role="menu">
                      {AUDIO_MODES.map((m) => (
                        <button
                          key={m}
                          className={'audio-item' + (audioMode === m ? ' active' : '')}
                          onClick={() => pickAudioMode(m)}
                        >
                          <span>{AUDIO_LABEL[m]}</span>
                          {audioMode === m && <span className="audio-check">✓</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="row">
              <div className="ctl-group" title="画质增强（实时渲染滤镜，仅作用于画面显示层）">
                <span className="ctl-label">增强</span>
                <div className="seg">
                  {ENHANCE_LEVELS.map((l) => (
                    <button
                      key={l}
                      className={'seg-btn' + (enhance === l ? ' active' : '')}
                      onClick={() => applyEnhance(l)}
                    >
                      {ENHANCE_LABEL[l]}
                    </button>
                  ))}
                </div>
              </div>
              <input
                className="ctl-vol"
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={vol}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  setVol(v)
                  if (videoRef.current) {
                    videoRef.current.volume = v
                    videoRef.current.muted = v === 0
                  }
                }}
                title="音量"
              />
              {!isIOS() && <button className="btn sm" onClick={togglePiP} title="画中画">画中画</button>}
              <button className="btn sm" onClick={() => void toggleFullscreen()} title="全屏">全屏</button>
              <label className="btn sm" title="加载外挂字幕（.srt / .vtt）">
                字幕
                <input
                  type="file"
                  accept=".srt,.vtt"
                  style={{ display: 'none' }}
                  onChange={(e) => e.target.files?.[0] && loadSubtitle(e.target.files[0])}
                />
              </label>
              <button className="btn sm" onClick={() => setSourceSidebar((v) => !v)} title="选集">选集</button>
            </div>
          </div>

          {/* 隐藏态 4px 品牌红渐隐提示条（暗示移动鼠标/点击唤出） */}
          {!controlsVisible && <div className="ctrl-fade-hint" />}

          {/* U7：常驻"后台小窗"按钮（始终显示在画面右下角，不依赖控制条唤出）；iOS WKWebView 无 HTML 画中画 → 隐藏 */}
          {!isIOS() && (
          <button
            className="pip-fab"
            title="后台小窗播放"
            aria-label="画中画"
            onClick={(e) => {
              e.stopPropagation()
              void togglePiP()
            }}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2.5" y="4.5" width="19" height="12" rx="2.5" />
              <rect x="12.5" y="10" width="7.5" height="4.5" rx="1.2" />
              <path d="M7.5 8.5h.01M11 8.5h.01M7.5 12.5h.01M11 12.5h.01" />
            </svg>
            <span>小窗</span>
          </button>
          )}

          {/* v3（UX）：切源顶部提示浮层（自动 1.8s 消失） */}
          {switchToast && <div className="player-toast">{switchToast}</div>}

          {/* 选集侧栏（T03 选集浮层） */}
          {sourceSidebar && (
            <div className="src-sidebar" onClick={(e) => e.stopPropagation()}>
              <div className="src-sidebar-head">
                <span>选集（{sources.length}）</span>
                <button className="btn sm" onClick={() => setSourceSidebar(false)}>关闭</button>
              </div>
              <div className="src-groups">
                {groups.map((g) => (
                  <div className="src-group" key={g.key}>
                    <div className="src-group-head" onClick={() => toggleGroup(g.key)}>
                      <span className="src-group-arrow">{g.collapsed ? '▸' : '▾'}</span>
                      <span className="src-group-title">{g.quality} · {g.format}</span>
                      <span className="src-group-count">{g.items.length}</span>
                    </div>
                    {!g.collapsed && (
                      <div className="src-group-body">
                        <div className="src-matrix">
                          {g.items.map(({ idx: i, source: s }) => (
                            <SourceCard
                              key={i}
                              s={s}
                              idx={i}
                              current={idx}
                              err={srcErr[i]}
                              onPick={() => {
                                switchTo(i)
                                setSourceSidebar(false)
                              }}
                            />
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 源面板（T05：清晰度 × 格式 二维分组折叠） */}
        <div className="src-panel">
          <div className="src-head">
            <strong className="src-title">播放源 ({sources.length})</strong>
            <div className="src-head-right">
              {!isCapacitor() && (
                <label
                  className="proxy-toggle"
                  title="播放请求是否走本地代理（解决跨域/区域限制）。默认开启；播放失败时会自动临时改路（直连↔代理），不影响此偏好"
                >
                  <input
                    type="checkbox"
                    checked={proxyPref}
                    onChange={(e) => {
                      const v = videoRef.current
                      if (v && v.currentTime > 0) seekRef.current = v.currentTime
                      const val = e.target.checked
                      proxyPrefRef.current = val
                      setProxyPref(val)
                      setUseProxyForPlay(val)
                      // 即时持久化 proxyByDefault（下次播放默认态，与全局开关解耦）
                      onPlaybackChangeRef.current?.({
                        speed,
                        enhance,
                        lastSourceIdx: idx,
                        proxyByDefault: val,
                        audioMode
                      })
                    }}
                  />
                  播放走代理
                </label>
              )}
              {badge && <span className="pill">{badge}</span>}
            </div>
          </div>
          <div className="src-groups">
            {groups.map((g) => (
              <div className="src-group" key={g.key}>
                <div className="src-group-head" onClick={() => toggleGroup(g.key)}>
                  <span className="src-group-arrow">{g.collapsed ? '▸' : '▾'}</span>
                  <span className="src-group-title">{g.quality} · {g.format}</span>
                  <span className="src-group-count">{g.items.length}</span>
                </div>
                {!g.collapsed && (
                  <div className="src-group-body">
                    <div className="src-matrix">
                      {g.items.map(({ idx: i, source: s }) => (
                        <SourceCard
                          key={i}
                          s={s}
                          idx={i}
                          current={idx}
                          err={srcErr[i]}
                          onPick={() => switchTo(i)}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
          {logs.length > 0 && (
            <div className="player-logs">
              <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 4 }}>调试日志</div>
              {logs.map((l, i) => <div key={i}>{l}</div>)}
            </div>
          )}
        </div>

        <div className="hint" style={{ marginTop: 8 }}>
          快捷键：空格播放/暂停 · ←→ 快退/快进 · ↑↓ 音量 · F 全屏 · M 静音 · P 画中画 · Ctrl+Shift+C 控制条
        </div>
      </div>
    </div>
  )
}

// 源卡片（视频下方 & 选集侧栏共用）
function SourceCard({
  s,
  idx,
  current,
  err,
  onPick
}: {
  s: VideoSource
  idx: number
  current: number
  err?: string
  onPick: () => void
}) {
  return (
    <div
      className={'src-card' + (idx === current ? ' active' : '') + (err ? ' err' : '')}
      onClick={onPick}
      title="点击切换播放源"
    >
      <div className="src-card-top">
        <span className="src-card-name" title={s.name}>{s.name}</span>
        {idx === current && <span className="src-card-live">正在播放</span>}
      </div>
      <div className="src-card-badges">
        <span className="src-badge type">{srcTypeLabel(s)}</span>
        {s.quality && s.quality !== '未知' && (
          <span className="src-badge type">{s.quality}</span>
        )}
        {s.speed !== undefined && (
          <span className={'src-badge speed ' + (s.speed < 0 ? 'bad' : s.speed < 800 ? 'good' : 'mid')}>
            {s.speed < 0 ? '超时' : s.speed + 'ms'}
          </span>
        )}
        {err && <span className="src-badge err" title={err}>失败</span>}
      </div>
      <div className="src-card-actions">
        <button
          className="btn sm"
          title="复制播放地址"
          onClick={(e) => {
            e.stopPropagation()
            navigator.clipboard.writeText(s.url).catch(() => {})
          }}
        >
          复制
        </button>
        <button
          className={'btn sm ' + (idx === current ? 'primary' : '')}
          onClick={(e) => {
            e.stopPropagation()
            onPick()
          }}
        >
          {idx === current ? '播放中' : '切换'}
        </button>
      </div>
    </div>
  )
}
