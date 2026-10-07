@echo off
REM ============================================================
REM Pacific Chase - acces distant automatique (tunnel Cloudflare)
REM 1 clic : telecharge cloudflared si absent, demarre le jeu,
REM ouvre le tunnel, attend que l'URL reponde REALLY, l'affiche.
REM ============================================================
setlocal EnableDelayedExpansion
cd /d "%~dp0"

echo ============================================================
echo   Pacific Chase - ouverture de l'acces distant
echo ============================================================
echo.

REM --- 1. cloudflared ---
set CF=cloudflared.exe
if not exist "%CF%" (
  where cloudflared >nul 2>nul
  if not errorlevel 1 (
    for /f "delims=" %%p in ('where cloudflared') do copy /y "%%p" cloudflared.exe >nul
  ) else (
    echo cloudflared absent : telechargement automatique...
    powershell -NoProfile -Command "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile 'cloudflared.exe'"
  )
)
if not exist "%CF%" (
  echo [ERREUR] cloudflared.exe n'a pas pu etre obtenu.
  pause
  exit /b 1
)
cloudflared.exe --version >nul 2>&1
if errorlevel 1 (
  echo [ERREUR] cloudflared.exe ne s'execute pas correctement.
  echo Supprimez cloudflared.exe du dossier et relancez.
  pause
  exit /b 1
)
echo cloudflared : OK.

REM --- 2. serveur de jeu ---
powershell -NoProfile -Command "try{Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:8080/' -TimeoutSec 2|Out-Null;exit 0}catch{exit 1}" >nul 2>nul
if errorlevel 1 (
  echo Demarrage du serveur de jeu...
  start "Pacific Chase serveur" /min cmd /c ""%~dp0Start Pacific Chase.bat""
  echo Attente du demarrage du serveur ^(8 s^)...
  timeout /t 8 /nobreak >nul
) else (
  echo Serveur de jeu deja en cours.
)

REM --- 3. tunnel ---
echo Demarrage du tunnel Cloudflare...
if not exist data mkdir data
del /q data\tunnel.log 2>nul
start "Pacific Chase tunnel" /min cmd /c cloudflared.exe tunnel --url http://localhost:8080 ^>data\tunnel.log 2^>^&1

REM --- 4. capture de l'URL dans le log du tunnel ---
echo Recherche de l'URL publique ^(jusqu'a 30 s^)...
set URL=
for /l %%i in (1,1,30) do (
  if not defined URL (
    timeout /t 1 /nobreak >nul
    for /f "delims=" %%u in ('powershell -NoProfile -Command "$m=(Select-String -Path data\tunnel.log -Pattern 'https://[a-z0-9-]+[.]trycloudflare[.]com' -AllMatches -ErrorAction SilentlyContinue | Select-Object -First 1); if($m){$m.Matches[0].Value}"') do set URL=%%u
  )
)
if not defined URL (
  echo [ERREUR] URL introuvable. Journal du tunnel :
  type data\tunnel.log
  pause
  exit /b 1
)
echo URL du tunnel : %URL%

REM --- 5. attente que l'URL reponde vraiment (propagation DNS) ---
echo.
echo Attente de la propagation DNS de l'URL ^(peut prendre 1 a 2 min^)...
echo Ne fermez pas cette fenetre ni la fenetre "Pacific Chase tunnel".
set READY=0
for /l %%i in (1,1,24) do (
  if "!READY!"=="0" (
    timeout /t 5 /nobreak >nul
    powershell -NoProfile -Command "try{Invoke-WebRequest -UseBasicParsing -Uri '%URL%' -TimeoutSec 8|Out-Null;exit 0}catch{exit 1}" >nul 2>nul
    if not errorlevel 1 set READY=1
  )
)
echo %URL%> data\tunnel-url.txt

echo.
echo ============================================================
if "!READY!"=="1" (
  echo   ACCES DISTANT OUVERT ET VERIFIE
  echo.
  echo   URL a donner a vos joueurs :
  echo   %URL%
  echo.
  echo   Ouverture dans votre navigateur...
  start "" %URL%
) else (
  echo   TUNNEL LANCE, MAIS PAS ENCORE ACCESSIBLE
  echo.
  echo   L'URL n'a pas repondu apres 2 minutes :
  echo   %URL%
  echo.
  echo   Causes possibles :
  echo   - la propagation DNS peut etre lente chez vous : reessayez
  echo     l'URL dans votre navigateur dans quelques minutes
  echo   - la fenetre "Pacific Chase tunnel" s'est fermee : relancez
  echo     ce script
  echo   - votre antivirus coupe cloudflared : autorisez-le
  echo.
  echo   L'URL est enregistree dans data\tunnel-url.txt
)
echo.
echo   Pour couper : "Fermer acces distant.bat"
echo ============================================================
echo.
pause
