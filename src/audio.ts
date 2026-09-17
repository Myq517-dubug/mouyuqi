import { AudioMode } from './types'

/**
 * Web Audio 等效音频效果链（非真杜比解码）：
 *   video → MediaElementAudioSourceNode(src) → [效果链] → GainNode(master) → destination
 *
 * 生命周期约定（全项目唯一，见架构设计 §B.3）：
 *   - createMediaElementSource 同一 video 仅允许一次 → 通过 liveEngines 缓存 + attach/detach 复用
 *   - hls.js 切源只 attachMedia 同一 video 元素，音频路由不重建（连续播放不打断）
 *   - 切档时序：master 50ms 淡出 → 60ms 后重建链（src.disconnect 后接新链/直通）→ 淡入至原音量
 *   - 快速连点 200ms 防抖只取最后一次
 *   - 卸载 dispose()：全链断开 + ctx.close()
 *
 * 四档效果（原生节点，无第三方依赖）：
 *   - dolby    杜比环绕：StereoPanner LFO 微摆 ±0.15@0.15Hz + Delay 15ms(feedback 0.25 + lowpass 1200Hz) + highshelf 4kHz +3dB
 *   - spatial  空间音频：M-S 编解码，side 增益 ×1.8 加宽
 *   - bass     低音增强：lowshelf 100Hz +12dB + highshelf 8kHz −3dB + DynamicsCompressor(threshold −12, ratio 6)
 *   - original 原声：bypass 直通（src → master）
 */

const liveEngines = new WeakMap<HTMLVideoElement, AudioEngine>()
const pendingRelease = new WeakMap<HTMLVideoElement, { timer: any; engine: AudioEngine }>()

export class AudioEngine {
  ctx: AudioContext
  src: MediaElementAudioSourceNode
  master: GainNode
  /** 当前档位（原声时效果链为空） */
  private mode: AudioMode = 'original'
  /** 当前效果链的全部节点（含 LFO/增益），teardown 时统一 disconnect */
  private effectNodes: AudioNode[] = []
  /** 需要 stop 的振荡器（LFO） */
  private lfos: OscillatorNode[] = []
  private debounceTimer: any = null
  private rebuildTimer: any = null
  /** 已释放标记（模块级 attach/detach 需读取） */
  disposed = false

  constructor(video: HTMLVideoElement) {
    const Ctor: typeof AudioContext =
      window.AudioContext || (window as any).webkitAudioContext
    this.ctx = new Ctor()
    // 同页仅一次：由 attachAudioEngine 缓存保证
    this.src = this.ctx.createMediaElementSource(video)
    this.master = this.ctx.createGain()
    this.master.gain.value = video.volume || 1
    // 初始原声直通
    this.src.connect(this.master)
    this.master.connect(this.ctx.destination)
  }

  get currentMode(): AudioMode {
    return this.mode
  }

  /** 用户手势后恢复上下文（Autoplay 策略下可能 suspended） */
  resume() {
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {})
  }

  /** 切换档位：200ms 防抖只保留最后一次，随后执行淡出→重建链→淡入 */
  setMode(mode: AudioMode, volume: number) {
    if (this.disposed || mode === this.mode) return
    this.mode = mode
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null
      this.applyMode(mode, volume)
    }, 200)
  }

  /** 立即应用档位（挂载恢复持久化档位用，跳过防抖） */
  setModeNow(mode: AudioMode, volume: number) {
    if (this.disposed || mode === this.mode) return
    this.mode = mode
    this.applyMode(mode, volume)
  }

  private applyMode(mode: AudioMode, volume: number) {
    if (this.disposed) return
    // 50ms 淡出（timeConstant 0.05）
    const now = this.ctx.currentTime
    this.master.gain.cancelScheduledValues(now)
    this.master.gain.setTargetAtTime(0, now, 0.05)
    if (this.rebuildTimer) clearTimeout(this.rebuildTimer)
    this.rebuildTimer = setTimeout(() => {
      this.rebuildTimer = null
      if (this.disposed) return
      // 断开旧链，重建
      this.teardownChain()
      const built = this.buildChain(mode)
      if (built) {
        this.src.connect(built.first)
        built.last.connect(this.master)
      } else {
        // original 直通
        this.src.connect(this.master)
      }
      // 淡入至原音量
      const t = this.ctx.currentTime
      this.master.gain.cancelScheduledValues(t)
      this.master.gain.setTargetAtTime(Math.max(0.001, volume || 0.001), t, 0.05)
    }, 60)
  }

  private teardownChain() {
    for (const n of this.effectNodes) {
      try {
        n.disconnect()
      } catch {
        /* noop */
      }
    }
    this.effectNodes = []
    for (const o of this.lfos) {
      try {
        o.stop()
      } catch {
        /* noop */
      }
    }
    this.lfos = []
    try {
      this.src.disconnect()
    } catch {
      /* noop */
    }
  }

  /**
   * 构建效果链，返回 { first, last }；original 返回 null（src → master 直通）。
   * 所有创建节点统一 push 到 effectNodes，供 teardown 清理。
   */
  private buildChain(mode: AudioMode): { first: AudioNode; last: AudioNode } | null {
    if (mode === 'original') return null
    this.effectNodes = []

    if (mode === 'dolby') {
      // ① StereoPanner LFO 微摆：0.15Hz 正弦 → pan ±0.15
      const panner = this.ctx.createStereoPanner()
      const lfo = this.ctx.createOscillator()
      const lfoGain = this.ctx.createGain()
      lfo.frequency.value = 0.15
      lfoGain.gain.value = 0.15
      lfo.connect(lfoGain)
      lfoGain.connect(panner.pan)
      lfo.start()
      this.lfos.push(lfo)
      this.effectNodes.push(panner, lfoGain, lfo)
      // ② Delay 15ms + feedback 0.25 + lowpass 1200Hz 反馈环（模拟环绕声场）
      const delay = this.ctx.createDelay(1)
      delay.delayTime.value = 0.015
      const fb = this.ctx.createGain()
      fb.gain.value = 0.25
      const fbFilter = this.ctx.createBiquadFilter()
      fbFilter.type = 'lowpass'
      fbFilter.frequency.value = 1200
      delay.connect(fb)
      fb.connect(fbFilter)
      fbFilter.connect(delay)
      this.effectNodes.push(delay, fb, fbFilter)
      // ③ highshelf 4kHz +3dB 中高频轻提升
      const hs = this.ctx.createBiquadFilter()
      hs.type = 'highshelf'
      hs.frequency.value = 4000
      hs.gain.value = 3
      this.effectNodes.push(hs)
      return { first: panner, last: hs }
    }

    if (mode === 'spatial') {
      // M-S 编解码加宽：mid=(L+R)/2、side=(L−R)/2，side ×1.8；还原 L=mid+side、R=mid−side
      const splitter = this.ctx.createChannelSplitter(2)
      const merger = this.ctx.createChannelMerger(2)
      const mid = this.ctx.createGain()
      mid.gain.value = 0.5
      const invR = this.ctx.createGain()
      invR.gain.value = -1
      const sideRaw = this.ctx.createGain()
      sideRaw.gain.value = 1
      const side = this.ctx.createGain()
      side.gain.value = 0.5 * 1.8
      const invSide = this.ctx.createGain()
      invSide.gain.value = -1
      // 编码
      splitter.connect(mid, 0, 0) // L → mid
      splitter.connect(mid, 1, 0) // R → mid
      splitter.connect(sideRaw, 0, 0) // L → sideRaw
      splitter.connect(invR, 1, 0) // R → invR
      invR.connect(sideRaw, 0, 0) // −R → sideRaw
      sideRaw.connect(side, 0, 0)
      // 解码
      mid.connect(merger, 0, 0) // L = mid + side
      side.connect(merger, 0, 0)
      mid.connect(merger, 0, 1) // R = mid − side
      side.connect(invSide, 0, 0)
      invSide.connect(merger, 0, 1)
      this.effectNodes.push(splitter, mid, invR, sideRaw, side, invSide, merger)
      return { first: splitter, last: merger }
    }

    // bass 低音增强
    const ls = this.ctx.createBiquadFilter()
    ls.type = 'lowshelf'
    ls.frequency.value = 100
    ls.gain.value = 12
    const hs = this.ctx.createBiquadFilter()
    hs.type = 'highshelf'
    hs.frequency.value = 8000
    hs.gain.value = -3
    const comp = this.ctx.createDynamicsCompressor()
    comp.threshold.value = -12
    comp.ratio.value = 6
    this.effectNodes.push(ls, hs, comp)
    return { first: ls, last: comp }
  }

  /** 全链断开 + 关闭上下文（幂等） */
  dispose() {
    if (this.disposed) return
    this.disposed = true
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    if (this.rebuildTimer) clearTimeout(this.rebuildTimer)
    this.teardownChain()
    try {
      this.master.disconnect()
    } catch {
      /* noop */
    }
    this.ctx.close().catch(() => {})
  }
}

/**
 * 挂载音频引擎：同一 video 复用缓存实例（createMediaElementSource 同页仅一次）；
 * 重新挂载时取消挂起的释放（React StrictMode 双挂载复用同一引擎）。
 */
export function attachAudioEngine(video: HTMLVideoElement): AudioEngine | null {
  const pending = pendingRelease.get(video)
  if (pending) {
    clearTimeout(pending.timer)
    pendingRelease.delete(video)
  }
  const live = liveEngines.get(video)
  if (live && !live.disposed) return live
  try {
    const engine = new AudioEngine(video)
    liveEngines.set(video, engine)
    return engine
  } catch (e) {
    console.warn('[audio] createMediaElementSource 失败（video 已挂载或不可用），降级直通', e)
    return null
  }
}

/**
 * 卸载：延迟 200ms 释放（防 StrictMode 双挂载误杀）。200ms 内若重新挂载，
 * attachAudioEngine 会取消本次释放并复用引擎。
 */
export function detachAudioEngine(video: HTMLVideoElement): void {
  const live = liveEngines.get(video)
  if (!live || live.disposed) return
  const pending = pendingRelease.get(video)
  if (pending) clearTimeout(pending.timer)
  const timer = setTimeout(() => {
    pendingRelease.delete(video)
    if (!live.disposed) {
      live.dispose()
      liveEngines.delete(video)
    }
  }, 200)
  pendingRelease.set(video, { timer, engine: live })
}
