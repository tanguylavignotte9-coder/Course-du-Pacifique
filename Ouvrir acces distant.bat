@echo off
REM ============================================================
REM Pacific Chase — acces distant automatique (tunnel Cloudflare)
REM 1 clic : installe cloudflared si absent, demarre le jeu,
REM ouvre le tunnel, affiche l'URL a donner aux joueurs.
REM Aucun port de votre box n'est ouvert.
REM ============================================================
setlocal EnableDelayedExpansion
cd /d "%~dp0"

echo ============================================================
echo   Pacific Chase — ouverture de l'acces distant
echo ============================================================
echo.

REM --- 1. cloudflared : telechargement automatique si absent ---
set CF=cloudflared.exe
if not exist "%CF%" (
  where cloudflared >nul 2>nul
  if errorlevel 1 (
    echo cloudflared absent : telechargement automatique en cours...
    powershell -NoProfile -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile 'cloudflared.exe'"
    if not exist "%CF%" (
      echo [ERREUR] Telechargement impossible. Verifiez votre connexion internet.
      pause
      exit /b 1
    )
    echo cloudflared installe dans le dossier du projet.
  ) else (
    set CF=cloudflared
  )
)

REM --- 2. serveur de jeu : demarrage si non lance ---
powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:8080/' -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }" >nul 2>nul
if errorlevel 1 (
  echo Demarrage du serveur de jeu...
  start "Pacific Chase — serveur" /min cmd /c ""%~dp0Start Pacific Chase.bat""
  timeout /t 5 /nobreak >nul
) else (
  echo Serveur de jeu deja en cours.
)

REM --- 3. tunnel : lancement en arriere-plan, capture de l'URL ---
echo Demarrage du tunnel Cloudflare...
if not exist data mkdir data
del /q data\tunnel.log 2>nul
start /min "Pacific Chase — tunnel" cmd /c ""%~dp0%CF%" tunnel --url http://localhost:8080 > data\tunnel.log 2>&1"

echo Recherche de l'URL publique (quelques secondes)...
set URL=
for /l %%i in (1,1,30) do (
  if not defined URL (
    timeout /t 1 /nobreak >nul
    for /f "tokens=*" %%u in ('findstr /C:"trycloudflare.com" data\tunnel.log 2^>nul') do (
      set LINE=%%u
      set LINE=!LINE: =!
      set URL=!LINE:*https://=https://!
      for /f "tokens=1 delims=^|" %%a in ("!LINE!") do (
        echo %%a | findstr /C:"https://" >nul && set URL=%%a
      )
    )
  )
)

if not defined URL (
  echo.
  echo [ERREUR] L'URL n'a pas ete obtenue. Journal du tunnel :
  type data\tunnel.log
  pause
  exit /b 1
)

echo !URL!> data\tunnel-url.txt

echo.
echo ============================================================
echo   ACCES DISTANT OUVERT
echo.
echo   URL a donner a vos joueurs :
echo   !URL!
echo.
echo   (Copiez-la aussi depuis le fichier data\tunnel-url.txt)
echo   Pour couper l'acces distant : double-cliquez
echo   "Fermer acces distant.bat"
echo ============================================================
echo.
start "" !URL!
echo La page s'ouvre dans votre navigateur pour verifier.
pause
