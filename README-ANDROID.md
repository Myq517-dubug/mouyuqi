# M快播 · Android 移植说明

基于 **Capacitor 6** 把现有 React 前端（Vite 构建产物）打包进 Android WebView。
复用约 90% 现有代码（首页 / 搜索 / 播放器 UI / 分类列表页 / 杜比·空间音频等），
按平台做以下适配：

| 能力 | Electron（原） | Android（现） |
|---|---|---|
| 播放 HLS(m3u8) | hls.js + 本地代理 | hls.js 直连（WebView MSE），不走代理 |
| 播放 MP4 | `<video>` 直连/代理 | `<video>` 原生播放（ExoPlayer） |
| 本地代理 | Electron 主进程 HTTP 代理 | **移除**（Android 无 Node，WebView 播放无需代理） |
| 持久化 | 主进程 fs 写 data.json | Capacitor Preferences（JSON 存单一 key） |
| 收藏/历史/片单/设置 | 同 | 同（复用 AppData 结构） |
| 下载 | 主进程下载到指定目录 | WebView Blob + `<a download>` 触发系统下载；HLS 不支持合并下载 |
| 导入/导出资源站 JSON | 主进程对话框 | `<input type=file>` 读取 / 系统分享 |
| 窗口控制（最小化等） | 主进程 IPC | 移除（无窗口概念，TitleBar 自动隐藏） |
| 画中画 / 代理设置项 | 有 | PiP 按钮与代理设置项隐藏 |

## 代码结构（本次新增/改动）

- `src/platform.ts` — **新增**：平台检测（`isCapacitor()`/`isElectron()`）+ Capacitor 版 `window.api` 实现
- `src/main.tsx` — 启动时 `ensurePlatformApi()` 注入
- `src/Player.tsx` — Android 分支：MP4 原生播放、HLS 走 hls.js 直连（loader 不挂代理）、隐藏 PiP/代理 UI
- `src/pages.tsx` — 设置页隐藏代理/下载目录项
- `src/TitleBar.tsx` — Android 渲染 null（隐藏标题栏）
- `capacitor.config.ts` — **新增**：appId `com.mkuaibo.app`、webDir `dist`、`allowMixedContent`
- `index.html` — 移动端 viewport
- `package.json` — 新增 Capacitor 依赖与 `android:*` 脚本
- `build-apk.bat` — **新增**：一键构建 APK

## 构建 APK（两种方式）

### 方式一：一键脚本（推荐）

前置要求：
1. Node.js 18+
2. **JDK 17+**（`java -version` 确认）
3. **Android Studio**（含 SDK），并设置环境变量 `ANDROID_HOME`
4. 首次构建需联网下载 Gradle 依赖（国内网络建议配置镜像）

```
双击 build-apk.bat
```

脚本流程：环境检查 → npm install（含 Capacitor）→ `cap add android`（首次生成 android/ 工程）→ `npm run android:sync`（构建前端+同步）→ `gradlew assembleDebug`。

APK 输出：`android\app\build\outputs\apk\debug\app-debug.apk`

### 方式二：手动命令

```bash
# 1. 安装依赖
npm install

# 2. 生成 Android 工程（首次）
npx cap add android

# 3. 构建前端 + 同步 Web 资源到 Android
npm run android:sync   # = npm run build && npx cap sync android

# 4. 编译 APK
cd android
gradlew.bat assembleDebug
cd ..
```

## 常见问题

| 问题 | 处理 |
|---|---|
| `cap add android` 报 Gradle 下载超时 | 配置 Gradle 镜像：`android\gradle\wrapper\gradle-wrapper.properties` 中 `distributionUrl` 改为 `https://mirrors.cloud.tencent.com/gradle/gradle-8.x-all.zip` |
| 问题 | 处理 |
|---|---|
| `gradlew` 下载 Gradle 超时 | 已默认配置腾讯云 Gradle 镜像（`android\gradle\wrapper\gradle-wrapper.properties` 的 `distributionUrl` → `https://mirrors.cloud.tencent.com/gradle/gradle-8.2.1-all.zip`） |
| Maven 依赖（androidx 等）下载慢/失败 | 已在 `android\build.gradle` 与 `android\capacitor\build.gradle` 的 repositories 前置阿里云镜像（google/public/gradle-plugin），失败自动回退官方源 |
| 播放 m3u8 黑屏 | 确认 WebView 支持 MSE（Android 8+ 默认支持）；若仍失败，说明该 WebView 版本 MSE 受限，可升级 Android System WebView |
| 播放 http 源被拦 | 已在 `capacitor.config.ts` 开启 `allowMixedContent` + `AndroidManifest.xml` 开启 `usesCleartextTraffic` |
| 资源站搜索无结果 | 与桌面版一致：资源站端点会失效，请在「资源中心」测试/替换 |
| 需要正式签名包（release） | `cd android && gradlew.bat assembleRelease`，并配置 `android\app\build.gradle` 的 signingConfig |

## 桌面版不受影响

所有 Android 适配均通过 `isCapacitor()` 分支隔离，Electron 构建路径（`npm run dist` / `build.bat`）保持原逻辑，桌面功能不变。
