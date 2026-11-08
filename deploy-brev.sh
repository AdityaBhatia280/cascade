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

# 2. Install workspace dependencies (root + server + Frontend)
echo "[2/4] Installing dependencies..."
npm install
npm install -w server
npm install -w Frontend

# 3. Build TypeScript backend and Vite 6 frontend SPA
echo "[3/4] Building server and Frontend..."
npm run build

# 4. Launch Express server on PORT=5001 (serves both /api/* and Frontend/dist)
export PORT="${PORT:-5001}"
echo "[4/4] Starting Cascade on 0.0.0.0:${PORT}..."
echo "      Expose port ${PORT} in your Brev console (brev port-forward or Share Port ${PORT})."
npm run start

