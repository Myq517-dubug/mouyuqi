#!/usr/bin/env bash
# ============================================================
# M快播 · iOS 构建脚本
# 仅在 macOS + Xcode + CocoaPods 环境可运行（Windows 无法编译 iOS）。
# 产出「未签名 .ipa」，供 Windows 侧用 Sideloadly / AltStore
# 以免费 Apple ID 签名后安装到 iPhone（签名有效期 7 天）。
#
# 用法：
#   bash scripts/build-ios.sh              # 构建 + 打包未签名 ipa
#   bash scripts/build-ios.sh --no-pods    # 跳过 pod install（依赖未变时加速）
# ============================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

SKIP_PODS=0
for arg in "$@"; do
  case "$arg" in
    --no-pods) SKIP_PODS=1 ;;
    *) echo "未知参数: $arg" >&2; exit 2 ;;
  esac
done

# ---------- 环境前置校验 ----------
command -v xcodebuild >/dev/null 2>&1 || {
  echo "❌ 未找到 xcodebuild：iOS 构建必须在 macOS + Xcode 上执行（Windows/Linux 不支持）" >&2
  exit 1
}
command -v node >/dev/null 2>&1 || { echo "❌ 未找到 node" >&2; exit 1; }
[ -d node_modules ] || { echo "❌ 缺少 node_modules，请先执行 npm ci" >&2; exit 1; }

echo "==> [1/6] 生成图标（含 iOS 1024 AppIcon，与桌面/安卓同源）"
node scripts/gen-icon.mjs

echo "==> [2/6] 类型检查（renderer + electron）"
npx tsc -p tsconfig.json --noEmit
npx tsc -p tsconfig.electron.json --noEmit

echo "==> [3/6] 构建前端产物 dist/"
npx vite build

echo "==> [4/6] 同步 Web 资源到 iOS 工程"
# 用 copy 而非 sync：sync 会顺带跑 pod install，此处 pod 交由下一步显式控制
npx cap copy ios

if [ "$SKIP_PODS" -eq 0 ]; then
  echo "==> [5/6] CocoaPods 安装原生依赖"
  command -v pod >/dev/null 2>&1 || {
    echo "❌ 未找到 pod（CocoaPods）。安装：sudo gem install cocoapods" >&2
    exit 1
  }
  (cd ios/App && pod install)
else
  echo "==> [5/6] 跳过 pod install（--no-pods）"
fi

echo "==> [6/6] xcodebuild 编译（关闭代码签名 → 未签名 .app）"
(
  cd ios/App
  xcodebuild \
    -workspace App.xcworkspace \
    -scheme App \
    -configuration Release \
    -sdk iphoneos \
    -derivedDataPath build \
    CODE_SIGNING_ALLOWED=NO \
    CODE_SIGNING_REQUIRED=NO \
    CODE_SIGN_IDENTITY="" \
    CODE_SIGN_ENTITLEMENTS="" \
    build
)

APP_PATH="$ROOT/ios/App/build/Build/Products/Release-iphoneos/App.app"
[ -d "$APP_PATH" ] || { echo "❌ 未找到构建产物: $APP_PATH" >&2; exit 1; }

echo "==> 打包为 .ipa（Payload 目录结构）"
OUT_DIR="$ROOT/ios/dist"
rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR/Payload"
cp -R "$APP_PATH" "$OUT_DIR/Payload/"
(
  cd "$OUT_DIR"
  zip -qry "M快播-unsigned.ipa" Payload
  rm -rf Payload
)

IPA="$OUT_DIR/M快播-unsigned.ipa"
[ -f "$IPA" ] || { echo "❌ ipa 打包失败" >&2; exit 1; }

echo ""
echo "✅ 构建完成"
echo "   产物: $IPA"
echo "   大小: $(du -h "$IPA" | cut -f1)"
echo ""
echo "下一步（在 Windows 上执行）："
echo "   1. 下载该 .ipa"
echo "   2. 用 Sideloadly / AltStore 以免费 Apple ID 签名安装到 iPhone"
echo "   3. 首次安装后需在 设置 → 通用 → VPN与设备管理 中信任开发者证书"
