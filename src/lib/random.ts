/**
 * 可重现伪随机数生成器（mulberry32）。
 * 从原 providers.ts 迁移而来，供猜你喜欢等需要"同种子可复现"的能力使用。
 */

/**
 * mulberry32：32 位种子伪随机数发生器。
 * 给定相同 seed 总是产出相同序列，便于单元测试与"换一批"可复现。
 *
 * @param seed 32 位无符号整数种子（建议先对小数 seed 做 Math.floor(seed * 1e9) >>> 0 放大）
 * @returns   一个返回 [0,1) 浮点数的函数
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
