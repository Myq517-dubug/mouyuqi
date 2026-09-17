// 兼容层 barrel：v2 将各页面拆分为 ./pages/* 模块。
// 为保持 v1 导出契约不变（App.tsx 等调用方零改动），此处统一 re-export。
export * from './pages/index'
