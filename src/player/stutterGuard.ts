/**
 * 卡顿检测阈值常量（StutterGuard 看门狗逻辑）。
 * 从原 Player.tsx 原样迁移：STUTTER_WINDOW_MS / STUTTER_COOLDOWN_MS 与卡顿切源状态机相关常量。
 * 看门狗/卡顿切源算法逻辑保留在 Player.tsx 主组件内（依赖 React state/ref），此处仅抽离常量。
 */

// 卡顿事件聚合窗口（持久 ≥ 该值则判定卡顿）
export const STUTTER_WINDOW_MS = 1500
// 同源重试冷却，避免无限切换
export const STUTTER_COOLDOWN_MS = 3000
