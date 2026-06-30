#!/usr/bin/env sh
set -eu

cd /app

echo "[entrypoint] node=$(node -v)"

SAP_HOME="${SAPNWRFC_HOME:-}"
SDK_HEADER=""

if [ -n "$SAP_HOME" ]; then
  if [ -f "$SAP_HOME/include/sapnwrfc.h" ]; then
    SDK_HEADER="$SAP_HOME/include/sapnwrfc.h"
  elif [ -f "$SAP_HOME/inc/sapnwrfc.h" ]; then
    SDK_HEADER="$SAP_HOME/inc/sapnwrfc.h"
  fi
fi

if [ -n "$SDK_HEADER" ]; then
  echo "[entrypoint] SAP SDK header found at $SDK_HEADER"
else
  echo "[entrypoint] SAP SDK header not found (SAPNWRFC_HOME=$SAP_HOME)"
  echo "[entrypoint] node-rfc will not be installable inside container."
fi

if [ ! -d "node_modules" ]; then
  echo "[entrypoint] Installing base npm dependencies"
  npm install
fi

if node -e "import('node-rfc').then(()=>process.exit(0)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
  echo "[entrypoint] node-rfc already available"
else
  if [ -n "$SDK_HEADER" ]; then
    echo "[entrypoint] Installing node-rfc (requires SAP SDK mounted)"
    npm install node-rfc
  else
    echo "[entrypoint] Skipping node-rfc install (SAP SDK header missing)"
  fi
fi

exec npm start

