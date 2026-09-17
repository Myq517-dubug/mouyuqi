/// <reference types="vite/client" />
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { ensurePlatformApi } from './platform'
import { ErrorBoundary } from './components/ErrorBoundary'
import './styles.css'

// 在 Capacitor（Android/iOS WebView）环境注入 window.api 实现；
// Electron 环境由 preload 注入，本调用为空操作。
ensurePlatformApi()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
)
