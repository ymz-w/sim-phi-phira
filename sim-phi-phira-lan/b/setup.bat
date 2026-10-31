@echo off
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0"
title PhiraHub 安装 / 配置

echo ============================================================
echo   PhiraHub  B 端安装脚本
echo   安装依赖、放行防火墙端口、显示本机局域网地址
echo ============================================================
echo.

rem ---------- 请求管理员权限（放行防火墙需要） ----------
net session >nul 2>&1
if errorlevel 1 (
  echo [提示] 放行防火墙需要管理员权限，正在请求提升...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -WorkingDirectory '%~dp0' -Verb RunAs"
  exit /b
)

rem ---------- 查找 Python ----------
set "PY="
where py >nul 2>&1 && set "PY=py -3"
if not defined PY (
  where python >nul 2>&1 && set "PY=python"
)
if not defined PY (
  echo [错误] 未找到 Python。
  echo        请安装 Python 3.9 或更高版本，安装时勾选 Add python.exe to PATH。
  echo        下载地址: https://www.python.org/downloads/windows/
  echo.
  pause
  exit /b 1
)
echo [1/3] 检测到 Python:
%PY% --version
if errorlevel 1 (
  echo [错误] Python 无法运行，请重新安装。
  pause
  exit /b 1
)

rem ---------- pip 依赖 ----------
echo.
echo [2/3] 检查 pip 依赖（PhiraHub 仅用标准库，通常无需下载）...
%PY% -m pip install --disable-pip-version-check --upgrade pip >nul 2>&1
%PY% -m pip install --disable-pip-version-check -r "%~dp0requirements.txt"
if errorlevel 1 (
  echo [提示] pip 安装失败，但 PhiraHub 不依赖第三方包，可以继续。
)

rem ---------- 读取端口 ----------
%PY% -c "import json;print(json.load(open('config.json',encoding='utf-8')).get('port',8765))" > "%TEMP%\phirahub_port.txt" 2>nul
set "PORT="
if exist "%TEMP%\phirahub_port.txt" set /p PORT=<"%TEMP%\phirahub_port.txt"
if not defined PORT set "PORT=8765"
del "%TEMP%\phirahub_port.txt" >nul 2>&1

rem ---------- 放行防火墙 ----------
echo.
echo [3/3] 放行防火墙 TCP 端口 %PORT% ...
netsh advfirewall firewall delete rule name="PhiraHub %PORT%" >nul 2>&1
netsh advfirewall firewall add rule name="PhiraHub %PORT%" dir=in action=allow protocol=TCP localport=%PORT% profile=private,domain >nul
if errorlevel 1 (
  echo [警告] 防火墙规则添加失败，请确认以管理员身份运行本脚本，
  echo        或手动在 Windows 防火墙中放行 TCP %PORT%。
) else (
  echo [OK] 已放行 TCP %PORT%（专用网络 / 域网络）。
)

rem ---------- 显示本机 IP ----------
echo.
echo ============================================================
echo   本机局域网地址（在平板 A 端填写其中一个 + 端口 %PORT%）
echo ============================================================
%PY% "%~dp0show_ip.py"
echo.
echo   下一步：
echo     1. 双击 start.bat 启动代理服务（后台静默运行，无窗口）
echo     2. 平板 A 端打开 index.html，进入 Phira 曲库 输入上面的 IP 和端口
echo     3. 连接失败时查看 hub.log，或运行 status.bat 自检
echo ============================================================
echo.
pause
