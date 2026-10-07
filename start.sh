#!/usr/bin/env bash
# Pacific Chase — démarrage en un clic (macOS / Linux)
# Installe et build si nécessaire, lance le serveur, ouvre le navigateur.
set -e
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "[ERREUR] Node.js n'est pas installé. https://nodejs.org"
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "Installation des dépendances (une seule fois)..."
  npm install
fi

if [ ! -f client/dist/index.html ]; then
  echo "Build du client (une seule fois)..."
  npm run build
fi

echo "Démarrage du serveur sur http://localhost:8080 ..."
( sleep 2
  if command -v open >/dev/null 2>&1; then open http://localhost:8080
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open http://localhost:8080
  fi
) &
exec npm start --workspace server
