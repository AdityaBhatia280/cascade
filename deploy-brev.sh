#!/usr/bin/env bash
set -euo pipefail

echo "============================================================"
echo "  Cascade — NVIDIA Brev Single-Port Production Deployment   "
echo "============================================================"

# 1. Ensure Node.js 20+ is installed on the Brev Ubuntu instance
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -d. -f1 | tr -d 'v')" -lt 20 ]; then
  echo "[1/4] Installing Node.js 20 LTS..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
else
  echo "[1/4] Node.js $(node -v) already installed."
fi

# 2. Install dependencies (root, server, Frontend; postinstall adds the embedded 3D app in cascade-main/cascade-main)
echo "[2/4] Installing dependencies..."
npm install

# 3. Build the server, the Frontend SPA, and the embedded 3D app's frontend (served at /dynamic-app/)
echo "[3/4] Building server, Frontend and the 3D site app..."
npm run build

# 4. One process on PORT: serves the SPA, /api, /dynamic-app and /dynamic-api, and runs the 3D app's
#    server as a child on 127.0.0.1:DYNAMIC_PORT (default 5002, not exposed)
export PORT="${PORT:-5001}"
export HOST="${HOST:-0.0.0.0}"
echo "[4/4] Starting Cascade on 0.0.0.0:${PORT}..."
echo "      Expose port ${PORT} in your Brev console (brev port-forward or Share Port ${PORT})."
npm run start
