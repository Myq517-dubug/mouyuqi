/**
 * 持久化辅助：dataRef（最新数据镜像）+ persist（函数式更新 + 落盘节流）。
 * 从原 App.tsx 迁移而来，作为通用基础设施供上层（App）复用。
 *
 * 设计要点（v3）：
 * - dataRef 始终持有一份"最新已合并数据"镜像，消除闭包竞态（高频写入方不会覆盖彼此）。
 * - persist 以函数式更新从最新数据出发合并，内存 state 即时更新；
 *   deferSave 为 true 时磁盘写入延迟 4s 合并（进度上报专用）。
 */

import type { AppData } from '../types'

/** 最新 AppData 镜像（用 ref 形态暴露，逻辑层以 .current 读取）。 */
export const dataRef: { current: AppData | null } = { current: null }

/** 落盘节流定时器句柄（模块级，persist 内部共享）。 */
export const saveTimerRef: { current: any } = { current: null }

/**
 * 基于 dataRef 的函数式持久化更新。
 *
 * @param updater  接收最新 AppData，返回合并后的新 AppData
 * @param opts.deferSave  为 true 时延迟 4s 合并落盘（进度上报等高频写专用）
 * @param save      实际落盘函数（注入 window.api.saveData 等），由上层提供
 */
export function persist(
  updater: (d: AppData) => AppData,
  opts?: { deferSave?: boolean },
  save?: (data: AppData) => void
): void {
  const cur = dataRef.current
  if (!cur) return
  const next = updater(cur)
  dataRef.current = next
  if (opts?.deferSave) {
    if (!saveTimerRef.current) {
      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null
        if (dataRef.current && save) save(dataRef.current)
      }, 4000)
    }
  } else {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    if (save) save(next)
  }
}
