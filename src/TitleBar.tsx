// 自定义标题栏（无边框窗口下提供拖拽 + 窗口控制按钮）
// - 大块可拖拽区域使用 -webkit-app-region: drag
// - 控制按钮使用 -webkit-app-region: no-drag，避免点击按钮时触发拖拽
// - Android 端无窗口概念，直接渲染空（高度 0），布局自动塌陷
import { isCapacitor } from './platform'

export default function TitleBar() {
  if (isCapacitor()) return null
  return (
    <div className="titlebar">
      <div className="titlebar-drag" />
      <div className="titlebar-controls">
        <button
          className="titlebar-btn"
          aria-label="最小化"
          title="最小化"
          onClick={() => window.api.windowMinimize()}
        >
          ─
        </button>
        <button
          className="titlebar-btn"
          aria-label="最大化"
          title="最大化 / 还原"
          onClick={() => window.api.windowToggleMaximize()}
        >
          ▢
        </button>
        <button
          className="titlebar-btn close"
          aria-label="关闭"
          title="关闭"
          onClick={() => window.api.windowClose()}
        >
          ✕
        </button>
      </div>
    </div>
  )
}
