@echo off
rem 本机 AI 额度上报器（一次性）
rem 常驻上报已合并进看板服务 :8787 —— 每次出图顺带推一次，无需再开一个常驻进程。
rem 这个脚本只用于手动补推：report_quota.bat [--force] [--dry]
rem 前置：复制 report_secrets.example.bat 为 report_secrets.bat 并填入 Token/仓库
setlocal
cd /d C:\Users\Shen\WorkBuddy\2026-08-16-01-28-56

if exist tools\report_secrets.bat call tools\report_secrets.bat

rem 必须用托管 Node 22.x：better-sqlite3 预编译为 ABI 127，系统 node v24 是 ABI 137 会加载失败
set "NODE=C:\Users\Shen\.workbuddy\binaries\node\versions\22.12.0\node.exe"

if "%GITHUB_TOKEN%"=="" (
  echo [warn] GITHUB_TOKEN 未设置，只写本地 data\quotas.json，不推远端
)
if "%GITHUB_REPO%"=="" (
  echo [warn] GITHUB_REPO 未设置，只写本地 data\quotas.json，不推远端
)

"%NODE%" tools\report_quota.js %* >> tools\report_quota.log 2>&1
echo [%date% %time%] reporter exited (code %errorlevel%) >> tools\report_quota.log
endlocal
