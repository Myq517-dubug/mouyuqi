# M快播 · iOS 移植说明

基于 **Capacitor 6 iOS** 把现有 React 前端（Vite 构建产物 `dist/`）打包进 iOS WKWebView。  
与 Android 版同源，`src/platform.ts` 已把平台差异收敛为一组 `isCapacitor() / isIOS() / isAndroid()` 分支，  
**约 90% 代码零改动复用**（首页 / 搜索 / 播放器 UI / 分类列表页 / 收藏历史 / 资源中心）。

> **本次移植的关键前提：iOS 编译必须在 macOS + Xcode 上完成，Windows 无法产出 `.ipa`。**  
> 因此本项目采用「Windows 开发 + GitHub Actions macOS runner 云构建」链路，见下文第 4 节。

---

## 1. 平台差异对照（Electron / Android / iOS）

| 能力           | Electron（桌面）              | Android（WebView）                             | iOS（WKWebView）                    |
| ------------ | ------------------------- | -------------------------------------------- | --------------------------------- |
| 播放 HLS(m3u8) | hls.js + 本地代理             | `<video>` 原生播放                               | `<video>` 原生播放（iOS 原生 HLS 支持最强）   |
| 播放 MP4       | `<video>` 直连/代理           | `<video>` 原生（ExoPlayer）                      | `<video>` 原生（AVPlayer）            |
| 本地代理         | 主进程 HTTP 代理               | 移除                                           | 移除                                |
| http 明文源     | 无限制                       | `usesCleartextTraffic` + `allowMixedContent` | **`Info.plist` ATS 放行（否则必黑屏）**    |
| 持久化          | 主进程 fs 写 data.json        | localStorage                                 | localStorage                      |
| 搜索/API 跨域    | 主进程代理                     | CapacitorHttp 原生请求                           | CapacitorHttp 原生请求                |
| 导入资源站 JSON   | 主进程对话框                    | `<input type=file>`                          | `<input type=file>`               |
| 导出资源站 JSON   | 主进程写文件                    | `navigator.share`                            | `navigator.share`                 |
| 下载视频         | 主进程下载到目录                  | Blob + `<a download>`                        | ❌ **不可用（WKWebView 无 `download`）** |
| 画中画 PiP      | HTML PiP                  | HTML PiP                                     | ❌ **不可用（WKWebView 无 HTML PiP）**   |
| 全屏           | `requestFullscreen`       | `requestFullscreen` + 方向锁                    | `webkitEnterFullscreen`（原生播放器全屏）  |
| 横屏锁定         | `screen.orientation.lock` | 支持                                           | ❌ 不支持（全屏时系统自动横屏）                  |
| 音频引擎（杜比/空间）  | 有                         | 禁用                                           | 禁用（同 Android）                     |
| 窗口控制         | 主进程 IPC                   | 移除                                           | 移除                                |

---

## 2. 代码结构（本次 iOS 移植改动）

| 文件                                | 改动                                                                                                                                               |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/platform.ts`                 | 新增 `isIOS()` / `isAndroid()` / `capacitorPlatform()`；`PLATFORM` 类型扩为 `electron\|android\|ios\|web`；`download()` 增加 iOS 降级；`enterPip()` 错误提示按平台区分 |
| `src/App.tsx`                     | 平台 class 由硬编码 `platform-android` 改为按平台输出 `platform-ios` / `platform-android`                                                                     |
| `src/player/Player.tsx`           | iOS 隐藏「画中画」按钮与右下角「小窗」FAB；「全屏」按钮在 iOS 走 `webkitEnterFullscreen()` 回退                                                                              |
| `src/styles.css`                  | `.platform-ios` 共享 `.platform-android` 的布局规则；新增 iOS 顶部安全区（刘海/灵动岛）内缩                                                                              |
| `scripts/gen-icon.mjs`            | 新增输出 iOS `AppIcon-512@2x.png`（1024×1024）与启动图 `splash-2732x2732*.png`（品牌深底 + 居中 logo），与桌面/安卓同源几何                                                                                       |
| `scripts/build-ios.sh`            | **新增**：macOS 端一键构建（类型检查 → vite build → cap copy → pod install → xcodebuild → 打包未签名 ipa）                                                          |
| `.github/workflows/ios-build.yml` | **新增**：GitHub Actions macOS runner 云构建，产出未签名 `.ipa` 工件                                                                                           |
| `package.json`                    | 新增 `@capacitor/ios` 依赖与 `ios:init / ios:sync / ios:copy / ios:open` 脚本                                                                           |
| `ios/`                            | **新增**：Capacitor 生成的 Xcode 工程（`ios/App/App.xcworkspace`）                                                                                         |
| `ios/App/App/Info.plist`          | **手改**：新增 ATS 放行 http 明文媒体                                                                                                                       |

另有两处配套改动：

- `ios/App/App/Base.lproj/LaunchScreen.storyboard`：**手改**，启动屏背景由系统白底（`systemBackgroundColor`）改为品牌深色 `#0e0e10`，深色主题 App 启动时不闪白
- `.gitignore`：**新增**，云构建前置（排除 `node_modules/`、构建产物、安装包、临时目录）

### 关键配置：Info.plist ATS

iOS 默认的 App Transport Security 会拦截所有 `http://` 请求。本 App 的大量资源站为 http 明文，  
**不配置必然黑屏**。已在 `ios/App/App/Info.plist` 加入：

```xml
<key>NSAppTransportSecurity</key>
<dict>
    <key>NSAllowsArbitraryLoads</key><true/>
    <key>NSAllowsArbitraryLoadsInWebContent</key><true/>
    <key>NSAllowsArbitraryLoadsForMedia</key><true/>
</dict>
```

> 注意：这是「全放行」配置，用于自用/侧载场景。若将来要上架 App Store，  
> 需改为按域名白名单（`NSExceptionDomains`）并在审核说明中给出理由。

### 内联播放（已由 Capacitor 默认开启，无需额外配置）

`@capacitor/ios` 的 `CAPBridgeViewController.swift` 默认设置：

```swift
webViewConfiguration.allowsInlineMediaPlayback = true
webViewConfiguration.mediaTypesRequiringUserActionForPlayback = []
```

配合 `<video playsInline>`，视频可在页面内直接播放，不需要用户手势，也不会强制弹出全屏。

---

## 3. iOS 工程目录速览

```
ios/
├── App/
│   ├── App.xcodeproj
│   ├── App.xcworkspace          # pod install 后生成，xcodebuild 用这个
│   ├── Podfile                  # 声明 Capacitor / CapacitorPreferences / CapacitorShare
│   └── App/
│       ├── AppDelegate.swift
│       ├── Info.plist           # ← ATS 配置在这里
│       ├── Assets.xcassets/
│       │   ├── AppIcon.appiconset/AppIcon-512@2x.png   # 1024×1024，脚本生成
│       │   └── Splash.imageset/
│       └── public/              # ← cap copy 同步的 Web 产物（gitignore 忽略）
└── capacitor-cordova-ios-plugins/
```

---

## 4. 构建 .ipa（无 Mac → 云构建）

### 前置：提交并推送到 GitHub

仓库已就绪：`.git` 已初始化（分支 `main`），远端 `origin` → `https://github.com/Myq517-dubug/mouyuqi.git`，
`.gitignore` 已配置（`node_modules/`、`dist/`、`out/`、`release/`、`build/icon.*`、Android/iOS 构建产物、`*.apk`/`*.ipa` 均不入库）。

还差首次提交与推送 —— **git 身份尚未配置**，需先设置：



```bash
cd video-aggregator
git config user.name  "你的名字"
git config user.email "你的邮箱"
git add .
git commit -m "feat: M快播三端（Electron 桌面 / Android / iOS）"
git push -u origin main
```

### 触发云构建（两种方式）

**方式一：手动触发**  
GitHub 仓库 → `Actions` → 左侧选 `iOS Build (unsigned .ipa)` → `Run workflow`。

**方式二：打 tag 触发**

```bash
git tag ios-v1.0.0
git push origin ios-v1.0.0
```

构建约 10–20 分钟（首次 `pod install` 拉 CocoaPods 源码较慢）。  
完成后在 Actions 运行页面的 **Artifacts** 区下载 `M快播-ios-unsigned`，内含 `M快播-unsigned.ipa`。

### 本地 Mac 构建（有 Mac 时）

```bash
cd video-aggregator
npm ci
bash scripts/build-ios.sh          # 产出 ios/dist/M快播-unsigned.ipa
```

前置：Xcode（含命令行工具）、CocoaPods（`sudo gem install cocoapods`）。

---

## 5. 安装到 iPhone（Windows 侧载，免费 Apple ID）

云构建产出的是**未签名 ipa**，需要在本机用工具以你的 Apple ID 重新签名后安装：

### 方案 A：Sideloadly（Windows，推荐）

1. 下载安装 [Sideloadly](https://sideloadly.io/)（Windows 版）
2. iPhone 用数据线连电脑，iPhone 上「信任此电脑」
3. 打开 Sideloadly → 拖入 `M快播-unsigned.ipa`
4. `Apple ID` 填你的 Apple ID（免费账号即可），点击 `Start`
5. 输入 Apple ID 密码（部分账号需在 [appleid.apple.com](https://appleid.apple.com) 生成专用密码）
6. 安装完成后，iPhone 上：**设置 → 通用 → VPN与设备管理 → 信任你的开发者证书**

### 方案 B：AltStore / SideStore

同样是「签名 + 安装」链路，适合长期自签（SideStore 支持免电脑续签）。

### ⚠️ 免费 Apple ID 的限制（务必知悉）

| 限制                       | 说明                                                    |
| ------------------------ | ----------------------------------------------------- |
| **签名有效期 7 天**            | 7 天后 App 无法启动，需重新签名安装（Sideloadly 重跑 / SideStore 自动续签） |
| **同时最多 3 个自签 App**       | 免费账号限制                                                |
| **每周最多 10 个 App ID**     | 免费账号限制                                                |
| **无法上架 / 无法 TestFlight** | TestFlight 与 App Store 均需付费开发者账号（$99/年）               |

### 如果将来要长期稳定使用

- **付费开发者账号（$99/年）**：Ad Hoc 签名有效期 1 年，可注册 100 台设备 UDID
- **企业签名 / 超级签**：第三方服务，但在 Apple 收紧政策下存在掉签风险
- **App Store 上架**：⚠️ 本 App 聚合第三方资源站，内容合规风险极高，上架大概率被拒，不建议作为目标

---

## 6. 常见问题

| 问题                              | 处理                                                                                                       |
| ------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 视频黑屏、无报错                        | 99% 是 ATS 拦截 http 源。核对 `Info.plist` 的 `NSAppTransportSecurity` 是否存在且为 `NSAllowsArbitraryLoads=true`      |
| 搜索无结果                           | 同桌面/安卓：资源站端点会失效，在「资源中心」测试/替换                                                                             |
| 点「画中画」无反应                       | iOS 正常现象（WKWebView 不支持 HTML PiP），按钮已隐藏；如需 PiP 需接入原生 `AVPictureInPictureController` 插件                    |
| 点「全屏」无反应                        | 已改为 `webkitEnterFullscreen()`。若仍无效，说明 WKWebView 版本过旧，可改用系统播放器按钮                                          |
| 下载按钮报「暂不支持」                     | iOS 正常现象（WKWebView 无 `<a download>`）。如需下载需接入 `@capacitor/filesystem` 原生插件                                |
| `pod install` 卡住/超时             | 国内网络问题，可先执行 `pod repo update`，或配置镜像；CI 上一般无此问题                                                           |
| `cap copy ios` 报 safe-delete 失败 | Windows 上沙箱删除 `ios/App/App/config.xml` 被拦截所致，**Web 资源已正常复制**，可忽略；`config.xml` 是 Cordova 遗留文件，对 iOS 构建无影响 |
| `xcodebuild` 报 Pods 缺失          | 未执行 `pod install`，先 `cd ios/App && pod install`                                                          |
| 云端构建失败在 `npm ci`                | 确认 `package-lock.json` 已提交且与 `package.json` 一致                                                           |

---

## 7. 桌面版 / Android 版不受影响

所有 iOS 适配均通过 `isIOS()` 分支隔离：

- Electron 构建路径（`npm run dist` / `build.bat`）逻辑未变
- Android 构建路径（`build-apk.bat` / `npm run android:apk`）逻辑未变
- `isCapacitor()` 语义保持「Android 或 iOS」，原有 Capacitor 分支行为对 Android 完全一致
