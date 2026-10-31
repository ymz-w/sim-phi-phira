@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul
cd /d "%~dp0"
title PhiraHub 停止

if not exist "%~dp0hub.pid" (
  echo 没有找到 hub.pid，服务可能没有运行。
  echo 如果确实在运行，可打开任务管理器结束 pythonw.exe。
  pause
  exit /b
)

set /p PID=<"%~dp0hub.pid"
if "!PID!"=="" (
  echo hub.pid 内容为空，已删除。
  del "%~dp0hub.pid" >nul 2>&1
  pause
  exit /b
)

tasklist /FI "PID eq !PID!" 2>nul | find /i "!PID!" >nul
if errorlevel 1 (
  echo [提示] 进程 !PID! 已经退出，清理 hub.pid。
  del "%~dp0hub.pid" >nul 2>&1
  pause
  exit /b
)

echo 正在停止 PhiraHub (PID !PID!) ...
taskkill /PID !PID! /F
if errorlevel 1 (
  echo [提示] 结束进程失败，请用任务管理器手动结束。
) else (
  echo [OK] 已停止。
)
del "%~dp0hub.pid" >nul 2>&1
pause
