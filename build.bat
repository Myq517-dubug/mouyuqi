@echo off
chcp 65001 >nul
REM ============================================================
REM  M快播 —— 一键构建 exe 安装包
REM  用法：在本项目目录双击本文件（需已安装 Node.js 18+ 与 Git）
REM ============================================================
setlocal
cd /d %~dp0

echo [1/3] 设置国内镜像加速（提升 electron / 依赖下载速度）...
npm config set registry https://registry.npmmirror.com
set "ELECTRON_MIRROR=https://cdn.npmmirror.com/binaries/electron/"
set "ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/"

echo [2/3] 安装依赖（首次约需 2-5 分钟，取决于网速）...
call npm install
if errorlevel 1 (
  echo.
  echo [错误] 依赖安装失败，请检查网络后重试。
  pause
  exit /b 1
)

echo [3/3] 打包 exe（输出到 dist\ 目录）...
call npm run dist
if errorlevel 1 (
  echo.
  echo [错误] 打包失败，可先试 npm run build 看前端是否编译通过。
  pause
  exit /b 1
)

echo.
echo ============================================================
echo  构建完成！exe 安装包位于：%cd%\release\
echo ============================================================
pause
