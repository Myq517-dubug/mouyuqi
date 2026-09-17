/**
 * 下载队列管理器单元测试。
 * 覆盖：并发上限、失败重试（指数退避）、暂停/继续/取消、整体进度与计数。
 * 纯逻辑，无 DOM 依赖，可在 Vitest 下直接运行（npm test）。
 */
import { describe, it, expect, vi } from 'vitest'
import { QueueManager, type DownloadTask } from '../lib/downloadQueue'

// 可控的假下载函数：成功列表按 id 匹配；其余 reject
function makeFakeDownloader(okIds: Set<string>, latency = 5) {
  return vi.fn(async (task: DownloadTask) => {
    await new Promise((r) => setTimeout(r, latency))
    if (!okIds.has(task.id)) throw new Error('boom')
  })
}

describe('QueueManager', () => {
  it('并发不超过上限', async () => {
    const max = 2
    let current = 0
    let peak = 0
    const fn = vi.fn(async (task: DownloadTask) => {
      current++
      peak = Math.max(peak, current)
      await new Promise((r) => setTimeout(r, 10))
      current--
    })
    const q = new QueueManager(fn, { concurrency: max, maxRetries: 0 })
    for (let i = 0; i < 5; i++) q.enqueue({ id: 't' + i, url: 'u', name: 'n', dest: 'd' })
    // 等待全部结束
    await new Promise((r) => setTimeout(r, 120))
    expect(peak).toBeLessThanOrEqual(max)
    expect(q.counts().done).toBe(5)
  })

  it('失败任务按 maxRetries 重试后标记 error', async () => {
    const fn = makeFakeDownloader(new Set()) // 全部失败
    const q = new QueueManager(fn, { concurrency: 1, maxRetries: 2 })
    q.enqueue({ id: 'x', url: 'u', name: 'n', dest: 'd' })
    await new Promise((r) => setTimeout(r, 400)) // 初试 + 2 次重试（5/10/20ms 退避）
    const t = q.list().find((t) => t.id === 'x')!
    expect(t.status).toBe('error')
    // 1 次初试 + 2 次重试 = 3 次调用
    expect(fn.mock.calls.length).toBe(3)
  })

  it('成功任务最终为 done，失败一次后重试成功', async () => {
    // 第一次调用失败，第二次成功
    let calls = 0
    const fn = vi.fn(async (task: DownloadTask) => {
      calls++
      await new Promise((r) => setTimeout(r, 2))
      if (calls === 1) throw new Error('transient')
    })
    const q = new QueueManager(fn, { concurrency: 1, maxRetries: 3 })
    q.enqueue({ id: 'y', url: 'u', name: 'n', dest: 'd' })
    await new Promise((r) => setTimeout(r, 100))
    const t = q.list().find((x) => x.id === 'y')!
    expect(t.status).toBe('done')
    expect(t.retries).toBe(1)
  })

  it('暂停阻止 pending 启动，继续后完成', async () => {
    const fn = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 20))
    })
    const q = new QueueManager(fn, { concurrency: 1, maxRetries: 0 })
    q.enqueue({ id: 'p', url: 'u', name: 'n', dest: 'd' })
    q.pause('p')
    await new Promise((r) => setTimeout(r, 30))
    expect(q.list().find((t) => t.id === 'p')!.status).toBe('paused')
    expect(fn.mock.calls.length).toBe(0)
    q.resume('p')
    await new Promise((r) => setTimeout(r, 60))
    expect(q.list().find((t) => t.id === 'p')!.status).toBe('done')
  })

  it('取消移除未开始任务', async () => {
    const fn = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 20))
    })
    const q = new QueueManager(fn, { concurrency: 1, maxRetries: 0 })
    q.enqueue({ id: 'c', url: 'u', name: 'n', dest: 'd' })
    q.cancel('c')
    await new Promise((r) => setTimeout(r, 30))
    expect(q.list().find((t) => t.id === 'c')).toBeUndefined()
  })

  it('整体进度随完成数上升', async () => {
    const fn = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 5))
    })
    const q = new QueueManager(fn, { concurrency: 2, maxRetries: 0 })
    for (let i = 0; i < 4; i++) q.enqueue({ id: 'g' + i, url: 'u', name: 'n', dest: 'd' })
    expect(q.overallProgress()).toBe(0)
    await new Promise((r) => setTimeout(r, 60))
    expect(q.overallProgress()).toBe(100)
  })
})
