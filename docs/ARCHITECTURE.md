# M快播 架构设计文档（v2.0）

> 适用范围：Electron（Windows exe）+ Capacitor（Android APK）双端视频聚合器。
> 本文档描述 v2.0 解耦后的分层结构、接口契约、关键模块设计与质量保障策略。

## 1. 系统总览

```
┌─────────────────────────────────────────────────────────────┐
│                           UI 层                              │
│   App.tsx（外壳/路由/下载队列接线）· pages/* · player/*       │
├─────────────────────────────────────────────────────────────┤
│                     能力抽象层 Api                           │
│   ipc.ts（契约）· platform.ts（Capacitor 实现）· preload.ts  │
│   （Electron 注入）· 兼容 barrel（Player/pages/providers）   │
├─────────────────────────────────────────────────────────────┤
│                     业务与基础设施层                         │
│   providers/*（聚合/测速/缓存键）· lib/*（cache/correct/…）  │
│   components/*（Card/Skeleton/ErrorBoundary/Token）         │
└─────────────────────────────────────────────────────────────┘
        ▲ Electron 主进程（main.ts）        ▲ Android 原生壳（Gradle）
        本地代理 / 下载 / 持久化              Capacitor Bridge → WebView
```

**设计要点**
- 所有「平台能力」（窗口控制、文件选择、下载、PiP、MediaSession）经 `Api` 接口抽象，UI 只依赖契约，不直接触碰 Electron/IPC 或 Capacitor。
- 桌面端由 `preload.ts` 注入 `window.api`；安卓/WebView 端由 `platform.ts` 的 `ensurePlatformApi()` 注入。双端实现同一契约，UI 零分支。

## 2. 目录结构与分层

```
src/
  ipc.ts                  Api 接口契约（双端共用，唯一真相源）
  platform.ts             Capacitor/WebView 端 Api 实现 + ensurePlatformApi()
  main.tsx                渲染入口：ensurePlatformApi() + ErrorBoundary 包裹 App
  App.tsx                 应用外壳、路由、QueueManager 接线、下载队列 UI
  audio.ts                Web Audio 等效音频效果链（dolby/spatial/bass/original）
  Player.tsx              兼容 barrel → ./player/Player（维持 v1 契约）
  pages.tsx               兼容 barrel → ./pages/index
  providers.ts            兼容 barrel → ./providers/index
  pages/                  首页/搜索/详情/收藏历史/片单/资源中心/设置（按页拆分）
  player/                 Player.tsx + ProxyLoader/hls.js + controls + enhance + stutterGuard
  providers/              appleCms/search/category/home/meta/recommend/resource/speed/state/types
  lib/                    mapLimit/persist/random/safeArea/cache/correct/searchHistory/downloadQueue
  components/             Card/MiniCard/HScroll/Skeleton/Token/ErrorBoundary
  test/                   Vitest 单测 + setup
android/                  Capacitor 安卓工程（Asset 来自 dist 同步）
electron/                 main.ts（代理/下载/持久化）+ preload.ts（IPC 桥）
```

**依赖方向（单向，强制）**
```
lib  →  providers  →  pages / player / components
                ↘ App
```
- `lib` 不反向依赖任何上层；`providers` 依赖 `lib` 与 `types`，不依赖 `pages`。
- `pages`/`player` 依赖 `providers` 与 `lib`；`App` 依赖全部。
- 对外能力须经 `Api`（`ipc.ts`）抽象，禁止在 UI 内直接 `require('electron')` 或调 Capacitor 插件。

**兼容 barrel 规则**：`Player.tsx`/`pages.tsx`/`providers.ts` 仅 `export ... from` 重导出，**不含业务逻辑**，保证 v1 调用方零改动。新增逻辑写到子模块，不在 barrel 内增代码。

## 3. Api 契约（ipc.ts）

```ts
interface Api {
  // 窗口（桌面有效，安卓空操作）
  windowMinimize(): Promise<void>
  windowToggleMaximize(): Promise<void>
  windowClose(): Promise<void>
  // 文件
  openJsonFile(): Promise<string | null>
  openFile(): Promise<string | null>          // 安卓无本地对话框，返回 null
  saveJsonFile(opts): Promise<{ ok: boolean }>
  pickDir(): Promise<string | null>
  // 数据
  getData(): Promise<AppData>
  saveData(data): Promise<void>
  getProxyUrl(): Promise<string>
  setUpstreamProxy(url): Promise<void>
  // 下载
  download(opts: { url; name; savePath; mergeSegments?: boolean }): Promise<{ ok: boolean; error?: string }>
  onDownloadProgress(cb): void
  // 画中画 / 媒体会话（P2-3）
  enterPip(): Promise<{ ok: boolean; error?: string }>
  exitPip(): Promise<void>
  setMediaSession(meta: { title; artist?; artwork? }): void
}
```

- `download` 中 `mergeSegments` 为可选降级标记；桌面端 Electron 主进程已能自动识别 `.m3u8` 合并，无需显式传；安卓端 `platform.ts` 对 `.m3u8` 或 `mergeSegments=true` 直接返回 `{ ok:false, error:'安卓端暂不支持 HLS 合并下载，请直接在线播放' }`。
- `enterPip` 在安卓 WebView 上尝试调用原生 PiP，不支持时 `ok:false` 并带友好提示，UI 通过 `onToast` 反馈（软降级，不崩溃）。
- `setMediaSession` 安卓 WebView 原生支持：锁屏/通知栏播放控制 + 后台音频（应用在前台/后台均可，取决于系统策略；被杀进程后停止，属已知限制，需原生 Service 才能常驻，本项目不引入原生插件）。

## 4. 关键模块设计

### 4.1 两层缓存（lib/cache）
- `LocalStorageCache`：内存 `Map`（L1）+ `localStorage`（L2），TTL 默认 10min，LRU 上限 4MB，键前缀 `mkp:`。
- 首页 `getHomeFeed`、分类 `fetchCategoryPageAll` 以「启用站点签名 + 元数据开关 + 自定义源数」为缓存键，命中即返回，显著降低源站压力、提速冷启。

### 4.2 搜索增强（lib/correct + lib/searchHistory）
- `correctQuery(raw, dict?)`：错别字映射（`TYPO_DICT`，如 复联→复仇者联盟）优先，其次拼音首字母匹配 `COMMON_TITLES`（如 `ql`→权力的游戏）；未命中原样返回。
- `pinyinInitials(text)`：基于 `PINYIN_TABLE` 的 best-effort 中文→首字母。
- 搜索历史存 `localStorage['mkp:searchHistory']`，最多 10 条，去重置顶；SearchPage 空输入展示历史 chips（可点选重搜、✕删除、清空），实时联想浮层防抖 150ms 并给出「猜你想搜」纠偏建议。

### 4.3 下载队列（lib/downloadQueue）
- `QueueManager`（纯逻辑，可单测）：`enqueue/pause/resume/cancel/list/counts/overallProgress`。
- 内部 `pump/start`：并发上限（默认 3）、失败指数退避重试（500×2^(n-1) ms，默认 3 次）、整体进度回调 `onState`。
- App 接线：`download()` 改为 `queueRef.enqueue(...)`，下载函数经 `window.api.download` 透传；UI 底部显示「下载中 {active}/{total} · {overall}%」。

### 4.4 一键优化（SettingsPage）
- `runOptimize` → `checkAllResourceSites`（mapLimit 并发测速）→ 按延迟排序 → 关闭不可用源 → 推荐音画档位（enhance/audioMode）→ `applyOptimize` 写 `resourceSites` + `playback`。

### 4.5 播放内核（player/）
- `ProxyLoader`：hls.js 自定义 loader，经本地代理拉流，规避跨域（**只搬家不重写**）。
- `stutterGuard`：卡顿检测与自动降档/切源保护（**只搬家不重写**）。
- `appleCms` 解析逻辑在 `providers/appleCms.ts`（**只搬家不重写**）。
- `audio.ts`：Web Audio 等效效果链（dolby/spatial/bass/original），全项目唯一 `AudioContext` 生命周期约定。

### 4.6 全局错误边界（components/ErrorBoundary）
- `main.tsx` 用 `ErrorBoundary` 包裹 `App`：捕获渲染期异常，降级空态 + 「重试」按钮，避免整页白屏。各页面空态（如搜索「暂无结果」）独立处理。

## 5. 测试与质量保障

- **Vitest 单测**（`src/test/*`）：纯函数/核心逻辑优先（缓存、纠偏、队列、排序/过滤/分类/合并/推荐），目标覆盖率 ≥80%。
- **Playtest 回归**（`.playtest/`）：Playwright 脚本 + 截图对比（桌面/移动、浅/深主题），`.playtest/run_app_test.cjs` 内置 `window.api` 模拟（含 enterPip/exitPip/setMediaSession 等 v2 新增方法）。
- **校验命令**：`tsc -p tsconfig.json --noEmit`（渲染）、`tsc -p tsconfig.electron.json --noEmit`（主进程）、`vite build`、`npm test`。

## 6. 构建与发布

| 目标 | 命令 | 产物 | 注意 |
|------|------|------|------|
| Windows exe | `build.bat` / `npm run dist` | `dist/*.exe` | 设 npmmirror 镜像加速 |
| Android APK | `npm run build` → `npm run cap:sync` → `npm run cap:buildandroid` | `android/.../app-release.apk` | **必须**同步 `dist/` 到 `android/app/src/main/assets/public` |

> 铁律（不可违反）：不重构播放/聚合核心算法（ProxyLoader、stutterGuard、appleCms 只搬家不改写）；安卓 HLS 合并走降级方案 C（不引入 ffmpeg）；最小变更原则；沙箱手动构建须同步 dist→android assets。
