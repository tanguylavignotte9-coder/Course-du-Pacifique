#!/usr/bin/env bash
# Pacific Chase — couper l'accès distant (tue le tunnel Cloudflare)
# Le serveur de jeu local continue de tourner.
cd "$(dirname "$0")"
if [ -f data/tunnel.pid ]; then
  kill "$(cat data/tunnel.pid)" 2>/dev/null || true
  rm -f data/tunnel.pid
fi
pkill -f "cloudflared tunnel" 2>/dev/null || true
echo ""
echo "============================================================"
echo "  Accès distant FERMÉ. Le jeu continue en local"
echo "  (http://localhost:8080)."
echo "============================================================"
