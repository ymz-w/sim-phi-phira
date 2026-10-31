@echo off
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0"
title PhiraHub 启动

set "PYW="
where pythonw >nul 2>&1 && set "PYW=pythonw"
if not defined PYW (
  where pyw >nul 2>&1 && set "PYW=pyw -3"
)
if not defined PYW (
  echo [提示] 未找到 pythonw，改用 python 启动（会保留一个命令行窗口）。
  python "%~dp0PhiraHub.pyw"
  exit /b
)

start "" %PYW% "%~dp0PhiraHub.pyw"
timeout /t 2 >nul

echo ============================================================
echo   PhiraHub 已在后台启动（无窗口）
echo ============================================================
echo   日志文件: %~dp0hub.log
echo   自检页面: http://127.0.0.1:8765/   (端口以 config.json 为准)
echo.
echo   平板 A 端可填写的地址：
where python >nul 2>&1 && python "%~dp0show_ip.py"
echo.
timeout /t 6 >nul
