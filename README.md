# M快播

一个基于 **Electron + React + Vite + TypeScript + Capacitor** 的跨平台视频应用，支持 Windows 桌面（exe）与 Android（APK）双端。核心能力：多播放源一键切换、跨源搜索聚合、本地收藏/续播、可插拔资源 provider、画中画与后台播放、下载队列管理。

> 技术选型：用户自定义源 + 公开免费源（不内置抓取付费/盗版站点）；插件化 provider 便于扩展。

## ✨ 功能清单（v2.0）

**播放与源**
- **多源切换**：同一影片可维护多个播放源，支持手动切换、失败自动切源（stutterGuard 卡顿保护）
- **搜索聚合**：跨多个 provider 搜索，结果合并去重、按源分组
- **本地数据**：收藏夹 / 观看历史 / 记忆播放进度（续播），持久化
- **播放控制**：倍速、清晰度切换、字幕（内嵌 / srt / vtt）、音轨
- **画中画（PiP）**、迷你模式、全屏、快捷键（空格 / ←→ / ↑↓ / F / M / P）
- **后台播放**：安卓 WebView 通过 MediaSession 在通知栏/锁屏显示播放控制（进阶后台见下方说明）

**发现与体验（P1）**
- **两层缓存**：首页/分类接口缓存（内存 L1 + localStorage L2，TTL 10min，LRU 4MB），降低源站压力、提速冷启
- **搜索增强**：历史 chips（去重置顶、可点选重搜、可删除/清空）、实时联想浮层（防抖 150ms）、错别字/拼音首字母纠偏（"复联"→复仇者联盟、"ql"→权力的游戏）
- **一键优化**：实测全部资源站延迟 → 关闭不可用源 → 按网络推荐音画档位（增强/纯净）→ 一键应用
- **UI 统一**：抽取设计 token（RADIUS/SPACE/SKELETON），骨架屏替代加载态

**下载与安卓（P2）**
- **下载队列管理器**（QueueManager 纯逻辑）：并发上限、指数退避重试、暂停/继续/取消、整体进度指示
- **安卓 HLS 降级**：m3u8 合并下载在安卓端给出明确提示「安卓端暂不支持 HLS 合并下载，请直接在线播放」（不引入 ffmpeg）
- **安卓 PiP / 后台播放**：经 `window.api.enterPip/exitPip/setMediaSession` 抽象层，双端优雅降级

**质量保障（P3）**
- **全局错误边界**：渲染异常捕获，降级空态 + 重试，避免整页白屏
- **Vitest 单测**：纯函数/核心逻辑覆盖率（缓存、纠偏、队列、状态），`src/test/*`
- **自动化回归**：`.playtest/` Playwright 脚本 + 截图对比，覆盖桌面与移动布局

## 🧱 架构（v2.0 解耦后）

```
electron/
  main.ts        主进程：本地代理 / 数据持久化 / 下载(m3u8 合并) / 本地文件协议
  preload.ts     安全 IPC 桥（contextIsolation），注入 window.api（Electron 实现）
src/
  platform.ts    Api 抽象层实现（Capacitor/WebView 端），确保 window.api 契约
  ipc.ts         Api 接口契约定义（双端共用）
  App.tsx        应用外壳、路由、下载队列接线
  pages/         首页 / 搜索 / 收藏历史 / 我的片单 / 设置 / 详情（按页拆分）
  player/        播放内核：hls.js + ProxyLoader + 多源切换 + PiP/倍速/字幕/快捷键
  providers/     插件化资源聚合（跨源搜索去重）、资源站测试、缓存键
  lib/           mapLimit / persist / random / safeArea / cache / correct / searchHistory / downloadQueue
  components/    Card / MiniCard / HScroll / Skeleton / Token / ErrorBoundary
  test/         Vitest 单测（缓存、纠偏、队列、状态等）
android/        Capacitor 安卓工程（APK）
```

**依赖方向（单向）**：`lib → providers → pages/player/components`，所有对外能力经 `Api` 接口（`ipc.ts`）抽象，桌面与安卓各自实现，barrel 导出维持 v1 调用契约。

> ⚠️ 铁律：播放/聚合核心算法（ProxyLoader、stutterGuard、appleCms 解析）只搬家不重写；安卓 HLS 合并走降级方案（不引入 ffmpeg）。

## 🛠 本地构建

> 本环境无法运行 `npm install`（沙箱代理拦截 npm 的批量 HTTPS 请求）。在你自己的 Windows 机器上网络正常，按以下步骤即可构建。

**Windows 桌面（exe）—— 推荐一键构建**

直接双击项目根目录的 `build.bat`。或手动：

```bash
npm config set registry https://registry.npmmirror.com
set ELECTRON_MIRROR=https://cdn.npmmirror.com/binaries/electron/
set ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/
npm install
npm run dist      # 输出 exe 到 dist\
```

**Android（APK）**

```bash
npm install
npm run build            # 编译前端到 dist/
npm run android:sync     # 同步 dist 到 android/app/src/main/assets/public
npm run android:apk      # 用 Gradle 产出 APK
```

> 沙箱手动构建时，务必将 `dist/` 同步到 `android/app/src/main/assets/public`，否则 APK 仍是旧前端。

其他脚本：`npm run dev`（开发热更新）、`npm run build`（仅编译前端）、`npm run pack`（免安装目录）、`npm test`（Vitest）。

## ✅ 代码校验状态

- 渲染层类型检查（`tsc -p tsconfig.json --noEmit`）：通过
- 主进程类型检查（`tsc -p tsconfig.electron.json --noEmit`）：通过
- 前端打包（`vite build`）：通过
- 单元测试（Vitest）：`src/test/*`，需本地 `npm install && npm test`

## 📌 使用说明

1. 启动后在「插件中心 / 我的片单」添加你自己的播放源（m3u8 或 mp4 直链）。
2. 内置一个公开免费演示源便于上手；更多源按插件化 provider 扩展 `src/providers/`。
3. 设置中可开启「源代理」应对跨域 / 区域限制；「⚡一键优化」可自动测速并关闭失效源。
4. 安卓端播放时，系统通知栏/锁屏会显示播放控制（MediaSession）；画中画按钮在支持的 WebView 上可用。

## ⚠️ 合规提示

本应用仅做播放器与聚合框架，**不内置任何盗版 / 付费站点解析**。请仅添加你有权播放的公开免费资源或自有内容。

## 📝 v2.0 变更摘要

- **P0 架构解耦**：拆分三大巨文件（pages.tsx/Player.tsx/providers.ts）→ `src/pages`、`src/player`、`src/providers`、`src/lib`、`src/components`，引入 Vitest 单测。
- **P1 性能与体验**：首页/分类缓存层、搜索历史+联想+拼音/错别字纠偏、一键优化、UI token 统一+骨架屏。
- **P2 下载与安卓增强**：下载队列管理器、统一下载接口（platform.ts）、安卓 HLS 合并下载降级、安卓后台播放+PiP（MediaSession）。
- **P3 质量保障**：全局错误边界与降级空态、playtest 回归脚本增强、文档（README v2 / docs/ARCHITECTURE.md）。

详见 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)。
