/**
 * 兼容层（barrel）：原 providers.ts 已按 P0 拆分至 ./providers/* 子模块。
 * 此处仅重导出全部公共 API，确保 App.tsx / pages.tsx 等 `import ... from './providers'`
 * 调用方零改动、导出签名与 v1 完全一致。
 */
export * from './providers/index'
