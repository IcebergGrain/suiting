@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 请先安装 Node.js 22 或更高版本，然后重新打开。
  pause
  exit /b 1
)
if not exist "node_modules\@neteasecloudmusicapienhanced\api\package.json" (
  call npm ci --no-audit --no-fund
  if errorlevel 1 (
    echo 依赖安装失败，请检查网络后重试。
    pause
    exit /b 1
  )
)
node scripts\launch.mjs
pause
