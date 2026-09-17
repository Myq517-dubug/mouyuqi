/**
 * 兼容层（barrel）：原 Player.tsx 已按 P0 拆分至 ./player/* 子模块。
 * 此处仅重导出默认播放组件，确保 `import Player from './Player'`（App/pages 调用方）零改动。
 */
export { default } from './player/Player'
export { default as Player } from './player/Player'
