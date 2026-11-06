@echo off
rem ================================================================
rem  YukPlatform - hammasi BITTA oynada (npm start):
rem    boshqaruv markazi  http://localhost:3000/admin
rem    haydovchilar ilovasi  http://localhost  (nginx)
rem    tunnel (internet manzili oynada: [tunnel] Manzil ...), bot, collector
rem  Ishga tushirish: shu faylni ikki marta bosing
rem    (yoki terminalda: .\ishga-tushirish.bat)
rem  To'xtatish: shu oynada Ctrl+C - hammasi yumshoq to'xtaydi.
rem  Har birining logi shu oynada: [bot] ..., [collector] ...
rem    yoki boshqaruv markazi -> Loglar.
rem  Bot, collector va boshqalarni alohida oynada ishga tushirmang:
rem    alohida oynadagi botni boshqaruv markazi qayta yoqa olmaydi.
rem ================================================================
setlocal
rem Oyna o'zbekcha harflar va belgilarni to'g'ri ko'rsatishi uchun (UTF-8)
chcp 65001 >nul
title YukPlatform
rem Fayl qayerdan bosilsa ham, loyiha papkasida ishlaydi
cd /d "%~dp0"

where npm >nul 2>nul
if errorlevel 1 (
  echo Node.js topilmadi: https://nodejs.org dan o'rnating ^(24-versiya^).
  pause
  exit /b 1
)

rem Yangi kompyuterda yoki papka toza bo'lsa - kutubxonalar bir marta o'rnatiladi
if not exist node_modules (
  echo Kutubxonalar o'rnatilyapti ^(faqat birinchi marta^)...
  call npm install
  if errorlevel 1 goto :xato
)

call npm start
if errorlevel 1 goto :xato
exit /b 0

:xato
echo.
echo YukPlatform to'xtadi. Xato bo'lsa - sababi yuqorida yozilgan.
pause
exit /b 1
