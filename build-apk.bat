@echo off
chcp 65001 >nul
title M快播 - Android APK 一键构建
setlocal

echo ==========================================
echo   M快播 Android APK 构建脚本
echo   前置要求：Node.js 18+、JDK 17+、Android Studio（含 SDK 34）
echo   首次运行请先配置系统环境变量 ANDROID_HOME
echo ==========================================
echo.

rem ---------- 1. 环境检查 ----------
where node >nul 2>&1 || (echo [错误] 未安装 Node.js & pause & exit /b 1)
where java >nul 2>&1 || (echo [错误] 未安装 JDK 17+ & pause & exit /b 1)
if "%ANDROID_HOME%"=="" (
  if exist "%LOCALAPPDATA%\Android\Sdk" (
    set "ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk"
  ) else (
    echo [错误] 未找到 Android SDK，请安装 Android Studio 并设置 ANDROID_HOME 环境变量
    pause & exit /b 1
  )
)
echo [1/4] 环境检查通过 ^(ANDROID_HOME=%ANDROID_HOME%^)

rem ---------- 2. 安装依赖（走国内镜像加速） ----------
echo [2/4] 安装 npm 依赖（含 Capacitor）...
call npm config set registry https://registry.npmmirror.com
call npm install
if errorlevel 1 (echo [错误] npm install 失败 & pause & exit /b 1)

rem ---------- 3. 构建前端并同步到 Android assets ----------
echo [3/4] 构建前端并同步到 android\app\src\main\assets\public ...
call npm run build
if errorlevel 1 (echo [错误] 前端构建失败 & pause & exit /b 1)
if not exist "android\app\src\main\assets\public" mkdir "android\app\src\main\assets\public"
xcopy /E /Y /Q dist\* "android\app\src\main\assets\public\" >nul
echo      前端已同步

rem ---------- 4. Gradle 编译 Debug APK ----------
echo [4/4] Gradle 编译 Debug APK...
cd android
call gradlew.bat assembleDebug
if errorlevel 1 (echo [错误] Gradle 编译失败（国内网络可在 gradle\wrapper\gradle-wrapper.properties 把 distributionUrl 换成腾讯镜像） & pause & exit /b 1)
cd ..

echo.
echo ==========================================
echo   构建成功！
echo   APK 位于：android\app\build\outputs\apk\debug\app-debug.apk
echo   传到手机安装即可（需允许"安装未知来源应用"）
echo ==========================================
pause
