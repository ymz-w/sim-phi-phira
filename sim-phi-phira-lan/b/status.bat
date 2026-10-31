@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul
cd /d "%~dp0"
title PhiraHub 状态检查

set "PORT=8765"
for /f "usebackq delims=" %%P in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "try{(Get-Content '%~dp0config.json' -Raw ^| ConvertFrom-Json).port}catch{8765}"`) do set "PORT=%%P"
if not defined PORT set "PORT=8765"

echo ============================================================
echo   PhiraHub 状态  (端口 %PORT%)
echo ============================================================
echo.

if exist "%~dp0hub.pid" (
  set /p PID=<"%~dp0hub.pid"
  echo 记录的进程 PID: !PID!
) else (
  echo 没有 hub.pid（可能服务未启动，或不是用 start.bat 启动的）。
)

echo.
echo 健康检查 http://127.0.0.1:%PORT%/api/health :
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { (Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:%PORT%/api/health' -TimeoutSec 5).Content } catch { Write-Output ('连接失败: ' + $_.Exception.Message) }"

echo.
echo 平板 A 端可填写的地址：
where python >nul 2>&1 && python "%~dp0show_ip.py"
echo.
echo 最近日志（最后 15 行）:
powershell -NoProfile -ExecutionPolicy Bypass -Command "if (Test-Path '%~dp0hub.log') { Get-Content '%~dp0hub.log' -Tail 15 -Encoding utf8 } else { Write-Output '还没有日志' }"
echo.
pause
