/**
 * 并发控制工具：限制同时执行的异步任务数量。
 * 从原 providers.ts 的 mapLimit 迁移而来，作为通用基础设施供聚合层复用。
 */

/**
 * 以最大并发数 limit 执行 items 上的异步函数 fn，返回与输入等长的结果数组。
 * 任意任务失败时该位置结果为 undefined（不影响其它任务）。
 *
 * @param items   输入数组
 * @param limit   最大并发数（>=1）
 * @param fn      对每个元素执行的异步回调（接收元素与索引）
 * @returns       与 items 等长的结果数组（失败项为 undefined）
 */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (t: T, i: number) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let i = 0
  const worker = async () => {
    while (i < items.length) {
      const idx = i++
      out[idx] = await fn(items[idx], idx).catch(() => undefined as any)
    }
  }
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, () => worker())
  )
  return out
}
