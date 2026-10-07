@echo off
REM Pacific Chase - couper l'acces distant (tue le tunnel Cloudflare)
REM Le serveur de jeu local continue de tourner.
taskkill /IM cloudflared.exe /F >nul 2>nul
echo.
echo ============================================================
echo   Acces distant FERME. Le jeu continue en local
echo   ^(http://localhost:8080^).
echo ============================================================
echo.
pause
