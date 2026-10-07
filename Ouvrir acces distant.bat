@echo off
REM ============================================================
REM Pacific Chase — acces distant automatique (tunnel Cloudflare)
REM 1 clic : telecharge cloudflared si absent, demarre le jeu,
REM ouvre le tunnel, affiche l'URL a donner aux joueurs.
REM ============================================================
setlocal EnableDelayedExpansion
cd /d "%~dp0"

echo ============================================================
echo   Pacific Chase — ouverture de l'acces distant
echo ============================================================
echo.

REM --- 1. cloudflared : toujours present dans le dossier du projet ---
set CF=cloudflared.exe
if not exist "%CF%" (
  where cloudflared >nul 2>nul
  if not errorlevel 1 (
    echo cloudflared trouve sur le systeme : copie dans le dossier du projet...
    for /f "delims=" %%p in ('where cloudflared') do copy /y "%%p" cloudflared.exe >nul
  ) else (
    echo cloudflared absent : telechargement automatique...
    powershell -NoProfile -Command "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile 'cloudflared.exe'"
  )
)
if not exist "%CF%" (
  echo [ERREUR] cloudflared.exe n'a pas pu etre obtenu.
  echo Verifiez votre connexion internet, ou telechargez-le manuellement :
  echo https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
  pause
  exit /b 1
)
REM verification : l'exe doit vraiment s'executer
cloudflared.exe --version >nul 2>&1
if errorlevel 1 (
  echo [ERREUR] cloudflared.exe ne s'execute pas (telechargement incomplet ?).
  echo Supprimez cloudflared.exe du dossier du projet et relancez ce script.
  pause
  exit /b 1
)
echo cloudflared : OK.

REM --- 2. serveur de jeu : demarrage si non lance ---
powershell -NoProfile -Command "try{Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:8080/' -TimeoutSec 2|Out-Null;exit 0}catch{exit 1}" >nul 2>nul
if errorlevel 1 (
  echo Demarrage du serveur de jeu...
  start "Pacific Chase serveur" /min cmd /c ""%~dp0Start Pacific Chase.bat""
  timeout /t 8 /nobreak >nul
) else (
  echo Serveur de jeu deja en cours.
)

REM --- 3. tunnel : lancement, capture de l'URL ---
echo Demarrage du tunnel Cloudflare...
if not exist data mkdir data
del /q data\tunnel.log 2>nul
start "Pacific Chase tunnel" /min cmd /c cloudflared.exe tunnel --url http://localhost:8080 ^>data\tunnel.log 2^>^&1

echo Recherche de l'URL publique (jusqu'a 30 s)...
set URL=
for /l %%i in (1,1,30) do (
  if not defined URL (
    timeout /t 1 /nobreak >nul
    for /f "delims=" %%u in ('powershell -NoProfile -Command "$m=(Select-String -Path data\tunnel.log -Pattern 'https://[a-z0-9-]+[.]trycloudflare[.]com' -AllMatches -ErrorAction SilentlyContinue | Select-Object -First 1); if($m){$m.Matches[0].Value}"') do set URL=%%u
  )
)

if not defined URL (
  echo.
  echo [ERREUR] L'URL n'a pas ete obtenue. Journal du tunnel :
  echo.
  type data\tunnel.log
  echo.
  pause
  exit /b 1
)

echo %URL%> data\tunnel-url.txt

echo.
echo ============================================================
echo   ACCES DISTANT OUVERT
echo.
echo   URL a donner a vos joueurs :
echo   %URL%
echo.
echo   (aussi enregistree dans data\tunnel-url.txt)
echo   Pour couper : "Fermer acces distant.bat"
echo ============================================================
echo.
start "" %URL%
pause
