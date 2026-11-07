@echo off
title CondoRate - Pianificazione Rate e Flussi Condominiali (Porta 3019)
echo ===================================================================
echo   CONDORATE - Analisi Consuntivo, Simulazione Preventivo e Rate
echo   Porta dedicata: 3019
echo ===================================================================
echo.
cd /d "%~dp0"

:: Verifica se la porta 3019 e' gia' attiva
netstat -ano | findstr ":3019 " | findstr "LISTENING" >nul 2>&1
if %errorlevel%==0 (
    echo Il server CondoRate e' gia' attivo su http://localhost:3019
    echo Apertura del browser in corso...
    start http://localhost:3019
    exit /b 0
)

echo Avvio del server CondoRate e apertura automatica nel browser (http://localhost:3019)...
start "" cmd /c "timeout /t 2 /nobreak >nul && start http://localhost:3019"
npm run dev
pause
