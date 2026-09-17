/**
 * 下载队列管理器（纯逻辑，无 DOM / 平台依赖，可单测）。
 * 负责：并发上限控制、暂停/继续/取消、失败自动重试（指数退避）、整体进度统计。
 * 实际「下载动作」由注入的 downloadFn 完成（Electron 走主进程、Android 走 WebView fetch），
 * 本模块只管调度，不关心底层传输细节。
 */

export type DownloadStatus = 'pending' | 'active' | 'paused' | 'done' | 'error' | 'retry'

export interface DownloadTask {
  id: string
  url: string
  name: string
  /** 目标路径（Electron: 绝对路径；Android: 仅用于文件名派生） */
  dest: string
  status: DownloadStatus
  loaded: number
  total: number
  retries: number
  error?: string
  /** 预留：HLS 合并下载开关（ffmpeg 插件可用时由底层读取，降级时忽略） */
  mergeSegments?: boolean
}

export interface QueueManagerOptions {
  /** 同时进行的下载数上限（默认 3） */
  concurrency?: number
  /** 单任务最大重试次数（默认 3） */
  maxRetries?: number
  /** 进度回调（单任务 loaded/total 变化或整体进度变化） */
  onProgress?: (task: DownloadTask, overall: number) => void
  /** 队列状态变化回调（任意任务状态变化时触发，便于 UI 渲染列表） */
  onState?: (tasks: DownloadTask[]) => void
}

/** 实际下载函数：由上层注入。成功 resolve，失败 reject（队列据此重试）。 */
export type DownloadFn = (
  task: DownloadTask,
  onProgress?: (loaded: number, total: number) => void
) => Promise<void>

interface ResolvedOptions {
  concurrency: number
  maxRetries: number
  onProgress?: (task: DownloadTask, overall: number) => void
  onState?: (tasks: DownloadTask[]) => void
}

export class QueueManager {
  private tasks = new Map<string, DownloadTask>()
  private order: string[] = []
  private activeCount = 0
  private opts: ResolvedOptions
  private fn: DownloadFn

  constructor(fn: DownloadFn, opts?: QueueManagerOptions) {
    this.fn = fn
    this.opts = {
      concurrency: opts?.concurrency ?? 3,
      maxRetries: opts?.maxRetries ?? 3,
      onProgress: opts?.onProgress,
      onState: opts?.onState
    }
  }

  /** 入队一个下载（仅传业务字段，状态初始化为 pending）。 */
  enqueue(t: Omit<DownloadTask, 'status' | 'loaded' | 'total' | 'retries'>): void {
    const task: DownloadTask = { ...t, status: 'pending', loaded: 0, total: 0, retries: 0 }
    this.tasks.set(task.id, task)
    this.order.push(task.id)
    this.emitState()
    this.pump()
  }

  /** 暂停：pending 任务不再启动；active 任务无法中途中止，将继续执行直至结束。 */
  pause(id: string): void {
    const t = this.tasks.get(id)
    if (t && (t.status === 'pending' || t.status === 'retry')) {
      t.status = 'paused'
      this.emitState()
    }
  }

  /** 继续：paused / error 任务重新进入 pending。 */
  resume(id: string): void {
    const t = this.tasks.get(id)
    if (t && (t.status === 'paused' || t.status === 'error')) {
      t.status = 'pending'
      t.error = undefined
      this.emitState()
      this.pump()
    }
  }

  /** 取消：移除任务（进行中任务无法真正中断传输，但标记为已取消不再重试）。 */
  cancel(id: string): void {
    const t = this.tasks.get(id)
    if (!t) return
    if (t.status === 'active') {
      t.status = 'error'
      t.error = '已取消'
    } else {
      this.tasks.delete(id)
      this.order = this.order.filter((x) => x !== id)
    }
    this.emitState()
    this.pump()
  }

  /** 当前所有任务快照（按入队顺序）。 */
  list(): DownloadTask[] {
    return this.order.map((id) => this.tasks.get(id)!).filter(Boolean)
  }

  /** 状态计数。 */
  counts(): { pending: number; active: number; done: number; error: number; total: number } {
    const c = { pending: 0, active: 0, done: 0, error: 0, total: this.order.length }
    for (const id of this.order) {
      const t = this.tasks.get(id)
      if (!t) continue
      if (t.status === 'done') c.done++
      else if (t.status === 'active' || t.status === 'retry') c.active++
      else if (t.status === 'error') c.error++
      else c.pending++
    }
    return c
  }

  /** 整体进度（0–100）：已完成计 1，进行中按 loaded/total 估算，其余计 0。 */
  overallProgress(): number {
    const total = this.order.length
    if (!total) return 0
    let sum = 0
    for (const id of this.order) {
      const t = this.tasks.get(id)
      if (!t) continue
      if (t.status === 'done') sum += 1
      else if (t.status === 'active' && t.total > 0) sum += Math.min(1, t.loaded / t.total)
      else if (t.status === 'active') sum += 0.5
    }
    return Math.round((sum / total) * 100)
  }

  // ---------- 内部调度 ----------

  private pump(): void {
    if (this.activeCount >= this.opts.concurrency) return
    for (const id of this.order) {
      if (this.activeCount >= this.opts.concurrency) break
      const t = this.tasks.get(id)
      if (t && t.status === 'pending') this.start(id)
    }
  }

  private async start(id: string): Promise<void> {
    const t = this.tasks.get(id)
    if (!t || t.status !== 'pending') return
    t.status = 'active'
    this.activeCount++
    this.emitState()
    try {
      await this.fn(t, (loaded, total) => {
        t.loaded = loaded
        t.total = total
        this.emitProgress(t)
      })
      t.status = 'done'
      t.loaded = t.total || t.loaded
    } catch (e: any) {
      const willRetry = t.retries < this.opts.maxRetries
      if (willRetry) {
        t.retries++
        t.status = 'retry'
        this.emitState()
        // 指数退避：500ms, 1s, 2s...
        const delay = 500 * 2 ** (t.retries - 1)
        setTimeout(() => {
          // 仅当任务未被取消/暂停才真正重试
          const cur = this.tasks.get(id)
          if (cur && cur.status === 'retry') {
            cur.status = 'pending'
            this.emitState()
            this.pump()
          }
        }, delay)
      } else {
        t.status = 'error'
        t.error = String(e?.message || e)
      }
    } finally {
      this.activeCount = Math.max(0, this.activeCount - 1)
      this.emitState()
      // 无论成功失败，都尝试启动下一个等待任务
      this.pump()
    }
  }

  private emitProgress(t: DownloadTask): void {
    this.opts.onProgress?.(t, this.overallProgress())
  }

  private emitState(): void {
    this.opts.onState?.(this.list())
    // 同步触发一次进度（整体百分比可能因计数变化而改变）
    const snap = this.list()
    if (snap.length) this.opts.onProgress?.(snap[snap.length - 1], this.overallProgress())
  }
}

/**
 * 统一下载函数签名（平台无关）。
 * Electron：主进程落盘；Android：WebView fetch+Blob。
 * options.mergeSegments 预留给 ffmpeg 插件做 HLS 合并（降级时不依赖）。
 */
export type PlatformDownloadFn = (
  url: string,
  dest: string,
  onProgress?: (loaded: number, total: number) => void,
  options?: { mergeSegments?: boolean }
) => Promise<void>
