@echo off
rem Chay ung dung Mua hang tu dong (http://127.0.0.1:5000)
cd /d "%~dp0"
python -m pip install -q -r requirements.txt
start "" http://127.0.0.1:5000
python -X utf8 app.py
pause
