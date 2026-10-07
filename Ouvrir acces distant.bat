@echo off
REM Pacific Chase — tunnel Cloudflare (acces distant sans ouvrir de port)
REM Necessite cloudflared : https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
REM Apres installation, redemarrez ce script : il affiche une URL https://xxx.trycloudflare.com
REM a donner a vos joueurs. Aucun port de votre box n'est ouvert.
setlocal
cd /d "%~dp0"

where cloudflared >nul 2>nul
if errorlevel 1 (
  echo [ERREUR] cloudflared n'est pas installe.
  echo Telechargez-le ici :
  echo   https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
  echo puis relancez ce script.
  pause
  exit /b 1
)

echo Demarrage du serveur de jeu (si non deja lance)...
start "Pacific Chase serveur" cmd /c "Start Pacific Chase.bat"
timeout /t 3 /nobreak >nul

echo.
echo Tunnel Cloudflare en cours. URL publique ci-dessous (a donner aux joueurs) :
echo (Ctrl+C pour arreter le tunnel — le jeu continue en local)
echo.
cloudflared tunnel --url http://localhost:8080
pause
