@echo off
rem Chay thu ung dung tren may (can Node.js 20+, khong can Python): http://localhost:8787
cd /d "%~dp0"
if not exist node_modules call npm install
start "" http://localhost:8787
node dev\server.mjs
pause
