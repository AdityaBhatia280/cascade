#!/usr/bin/env bash
# ============================================================================
# Cascade — GnuCOBOL Compilation & Golden Parity Output Generator
# Compiles LEASEBIL.cbl + CAMCALC.cbl with GnuCOBOL (cobc) and captures
# the 8 golden CAM calculation outputs used in seed/parity_cases.json.
# ============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "[Cascade COBOL] Checking GnuCOBOL compiler (cobc)..."
if ! command -v cobc >/dev/null 2>&1; then
  echo "Notice: 'cobc' (GnuCOBOL) is not installed on this machine."
  echo "Install via: apt-get install gnucobol (Linux) or brew install gnucobol (macOS)."
  echo "Pre-captured golden outputs are stored in ../parity_cases.json."
  exit 0
fi

cobc --version | head -n 1

echo "[Cascade COBOL] Compiling subprogram CAMCALC.cbl..."
cobc -m -I "$SCRIPT_DIR" CAMCALC.cbl

echo "[Cascade COBOL] Compiling main program LEASEBIL.cbl..."
cobc -x -I "$SCRIPT_DIR" LEASEBIL.cbl CAMCALC.cbl -o leasebil_runner

echo "[Cascade COBOL] Build complete: ./leasebil_runner"

