#!/usr/bin/env bash
# Pacific Chase — tunnel Cloudflare (accès distant sans ouvrir de port)
# Nécessite cloudflared :
#   macOS :   brew install cloudflared
#   Linux :   https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
# Après installation, relancez ce script : il affiche une URL
# https://xxx.trycloudflare.com à donner à vos joueurs.
set -e
cd "$(dirname "$0")"

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "[ERREUR] cloudflared n'est pas installé."
  echo "  macOS : brew install cloudflared"
  echo "  Linux : voir https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
  exit 1
fi

# Démarre le serveur de jeu s'il ne tourne pas déjà
if ! curl -s -o /dev/null http://localhost:8080/ 2>/dev/null; then
  echo "Démarrage du serveur de jeu..."
  nohup ./start.sh > /tmp/pacific-chase.log 2>&1 &
  sleep 3
fi

echo ""
echo "Tunnel Cloudflare en cours. URL publique ci-dessous (à donner aux joueurs) :"
echo "(Ctrl+C pour arrêter le tunnel — le jeu continue en local)"
echo ""
exec cloudflared tunnel --url http://localhost:8080
