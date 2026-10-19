@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "HOST=0.0.0.0"
echo 仅在自己信任的局域网中使用。此模式不修改系统防火墙。
call "启动随听.cmd"
