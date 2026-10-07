@echo off
REM Pacific Chase - demarrage en un clic (Windows)
REM Installe et build si necessaire, lance le serveur, ouvre le navigateur.
REM Rebuild automatique quand les sources du client sont plus recentes
REM que le build (evite de servir une vielle interface).
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

REM Rebuild si le build est absent OU si une source est plus recente
set NEEDBUILD=0
if not exist client\dist\index.html set NEEDBUILD=1
if "%NEEDBUILD%"=="0" (
  powershell -NoProfile -Command "$src=(Get-ChildItem -Recurse client\src | Sort-Object LastWriteTime -Descending | Select-Object -First 1).LastWriteTime; $pkg=(Get-Item package.json).LastWriteTime; $out=(Get-Item client\dist\index.html).LastWriteTime; if($src -gt $out -or $pkg -gt $out){exit 1}else{exit 0}"
  if errorlevel 1 set NEEDBUILD=1
)
if "%NEEDBUILD%"=="1" (
  echo Build du client...
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
