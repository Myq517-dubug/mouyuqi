import React from 'react'

interface State {
  hasError: boolean
  error?: Error
}

/**
 * 全局错误边界：捕获渲染期异常，避免整页白屏。
 * 提供降级空态 + 重试，保证单个页面/组件崩溃不影响整体可用性。
 */
export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary">
          <div className="eb-card">
            <h2>出错了</h2>
            <p className="hint">应用遇到一个未预期的错误，已停止局部渲染以免白屏。可点击重试，或重启应用。</p>
            {this.state.error?.message && <pre className="eb-detail">{this.state.error.message}</pre>}
            <button
              className="btn primary"
              onClick={() => this.setState({ hasError: false })}
            >
              重试
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
