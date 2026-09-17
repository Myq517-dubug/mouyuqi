import type { CapacitorConfig } from '@capacitor/cli'

// Capacitor 配置：Android WebView 容器，webDir 指向 vite 构建产物 dist/
// - androidScheme https：Capacitor 默认 https://localhost 加载打包资源
// - allowMixedContent：允许 WebView 加载 http/https 混合媒体（多数资源站为 http）
const config: CapacitorConfig = {
  appId: 'com.mkuaibo.app',
  appName: 'M快播',
  webDir: 'dist',
  android: {
    allowMixedContent: true
  },
  server: {
    androidScheme: 'https'
  }
}

export default config
