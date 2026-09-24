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

#exec npm start
# ── Run as a non-root user ────────────────────────────────────────────────────
# The server process must NOT run as root, otherwise every file/folder it
# creates under the bind-mounted CodeSecurity/ folder ends up owned by root
# on the host and cannot be managed by the host user without sudo.
#
# Resolution order for the uid/gid to use:
#   1. HOST_UID / HOST_GID environment variables (optional manual override,
#      e.g. set in docker-compose.yml or .env)
#   2. owner of the mounted CodeSecurity folder (= the host user who owns
#      the project) — zero-config auto-detection
#   3. fallback: 1000:1000 (typical first user on Linux)
CS_ROOT="${CODE_SECURITY_ROOT:-/etc/sap/CodeSecurity}"

APP_UID="${HOST_UID:-$(stat -c '%u' "$CS_ROOT" 2>/dev/null || echo 1000)}"
APP_GID="${HOST_GID:-$(stat -c '%g' "$CS_ROOT" 2>/dev/null || echo 1000)}"

# The bind mount is auto-created by docker (owned by root) when the folder is
# missing on the host: in that case there is no meaningful owner -> fallback.
if [ "$APP_UID" = "0" ]; then
  echo "[entrypoint] CodeSecurity folder is owned by root: falling back to 1000:1000"
  APP_UID=1000
  APP_GID=1000
fi

# Create the group/user inside the container (numeric ids coming from the host).
# Names are unique per id, so re-creating them on every boot is never an issue.
if ! getent group "$APP_GID" >/dev/null 2>&1; then
  addgroup --gid "$APP_GID" "appgrp$APP_GID"
fi
if ! getent passwd "$APP_UID" >/dev/null 2>&1; then
  adduser --uid "$APP_UID" --gid "$APP_GID" --disabled-password --gecos "" "appusr$APP_UID"
fi

# (Re-)own the CodeSecurity tree: this also repairs files created by previous
# root-based runs, so the host user can delete/modify them without sudo.
if [ -d "$CS_ROOT" ]; then
  chown -R "$APP_UID:$APP_GID" "$CS_ROOT"
fi

# npm (started below) needs a writable HOME belonging to the runtime user
APP_HOME="$(getent passwd "$APP_UID" | cut -d: -f6)"
export HOME="${APP_HOME:-/tmp}"

echo "[entrypoint] Running as uid=$APP_UID gid=$APP_GID (home=$HOME)"
exec gosu "$APP_UID:$APP_GID" npm start
