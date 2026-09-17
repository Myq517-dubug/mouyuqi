/**
 * player 层 barrel：导出默认播放组件与公共常量，保持 v1 在 Player.tsx 的可用导出名。
 * 调用方（pages.tsx 的 DetailPage）继续 `import Player from './Player'` 或 `from './player'`。
 */

export { default } from './Player'
export { default as Player } from './Player'
export { ProxyLoader, setProxyBase, getProxyBase } from './ProxyLoader'
export { ENHANCE_LEVELS, ENHANCE_LABEL, enhanceFilter, srcTypeLabel } from './enhance'
export { STUTTER_WINDOW_MS, STUTTER_COOLDOWN_MS } from './stutterGuard'
export {
  SPEED_OPTIONS,
  QUALITY_RANK,
  bestIdx,
  buildGroups
} from './controls'
export type { Group, GroupedSource } from './controls'
