#!/usr/bin/env bash
# ============================================================
# Pacific Chase — accès distant automatique (tunnel Cloudflare)
# 1 clic : installe cloudflared si absent, démarre le jeu,
# ouvre le tunnel, affiche l'URL à donner aux joueurs.
# ============================================================
set -e
cd "$(dirname "$0")"

echo "============================================================"
echo "  Pacific Chase — ouverture de l'accès distant"
echo "============================================================"
echo

# --- 1. cloudflared : installation automatique si absent ---
CF=""
if command -v cloudflared >/dev/null 2>&1; then
  CF="cloudflared"
elif [ -x ./cloudflared ]; then
  CF="./cloudflared"
else
  OS=$(uname -s | tr '[:upper:]' '[:lower:]')
  ARCH=$(uname -m)
  [ "$ARCH" = "x86_64" ] && ARCH="amd64"
  [ "$ARCH" = "arm64" ] || [ "$ARCH" = "aarch64" ] && ARCH="arm64"
  URL="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-${OS}-${ARCH}"
  echo "cloudflared absent : téléchargement automatique..."
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL -o cloudflared "$URL" || { echo "[ERREUR] Téléchargement impossible ($URL)"; exit 1; }
  else
    wget -q -O cloudflared "$URL" || { echo "[ERREUR] Téléchargement impossible ($URL)"; exit 1; }
  fi
  chmod +x cloudflared
  CF="./cloudflared"
  echo "cloudflared installé dans le dossier du projet."
fi

# --- 2. serveur de jeu : démarrage si non lancé ---
if ! curl -s -o /dev/null --max-time 2 http://localhost:8080/ 2>/dev/null; then
  echo "Démarrage du serveur de jeu..."
  nohup ./start.sh > /tmp/pacific-chase.log 2>&1 &
  sleep 4
else
  echo "Serveur de jeu déjà en cours."
fi

# --- 3. tunnel : lancement en arrière-plan, capture de l'URL ---
echo "Démarrage du tunnel Cloudflare..."
mkdir -p data
rm -f data/tunnel.log
nohup "$CF" tunnel --url http://localhost:8080 > data/tunnel.log 2>&1 &
TUNNEL_PID=$!
echo "$TUNNEL_PID" > data/tunnel.pid

URL=""
for i in $(seq 1 30); do
  URL=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' data/tunnel.log 2>/dev/null | head -1 || true)
  [ -n "$URL" ] && break
  sleep 1
done

if [ -z "$URL" ]; then
  echo ""
  echo "[ERREUR] L'URL n'a pas été obtenue. Journal du tunnel :"
  cat data/tunnel.log
  exit 1
fi
echo "$URL" > data/tunnel-url.txt

echo ""
echo "============================================================"
echo "  ACCÈS DISTANT OUVERT"
echo ""
echo "  URL à donner à vos joueurs :"
echo "  $URL"
echo ""
echo "  (aussi dans data/tunnel-url.txt)"
echo "  Pour couper l'accès distant : ./fermer-acces-distant.sh"
echo "============================================================"
echo ""
(command -v open >/dev/null 2>&1 && open "$URL") || (command -v xdg-open >/dev/null 2>&1 && xdg-open "$URL") || true
