@echo off
REM Pacific Chase — demarrage en un clic (Windows)
REM Installe et build si necessaire, lance le serveur, ouvre le navigateur.
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERREUR] Node.js n'est pas installe. Telechargez-le sur https://nodejs.org
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installation des dependances ^(une seule fois^)...
  call npm install || goto :fail
)

if not exist client\dist\index.html (
  echo Build du client ^(une seule fois^)...
  call npm run build || goto :fail
)

echo Demarrage du serveur sur http://localhost:8080 ...
start "" http://localhost:8080
call npm start --workspace server
goto :end

:fail
echo [ERREUR] Le demarrage a echoue. Voyez les messages ci-dessus.
pause
exit /b 1

:end
pause
