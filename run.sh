#!/bin/bash

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="$BASE_DIR/node-bin/bin:$PATH"

export DB_HOST="localhost"
export DB_PORT="5432"
export DB_NAME="appdb"
export DB_USER="appuser"
export DB_PASSWORD="apppassword"

echo "Booting up environment dependencies..."

# Detect if using portable postgres or system host daemon
if [ -f "$BASE_DIR/postgres/bin/pg_ctl" ]; then
    echo "[INFO] Initializing portable database instance..."
    "$BASE_DIR/postgres/bin/pg_ctl" -D "$BASE_DIR/postgres/data" -l "$BASE_DIR/postgres/log.txt" start
else
    echo "[INFO] Bypassing localized db execution. Target system environment engine validation..."
fi

# Explicit validation loop using pg_isready or manual sleep
sleep 2

# Boot backend logic in an asynchronous sub-shell process
echo "[INFO] Launching ZSecTools Backend Service Engine..."
cd "$BASE_DIR"
node ./backend/src/server.js &
BACKEND_PID=$!

echo "==================================================="
echo "  ZSecTools running in interactive shell session."
echo "  Application active on http://localhost:3000"
echo "  Press CTRL+C to safely terminate processes."
echo "==================================================="

# Keep script interactive and handle graceful teardown signals
cleanup() {
    echo -e "\nIntercepted shutdown signal. Cleaning up active processes..."
    kill $BACKEND_PID 2>/dev/null
    if [ -f "$BASE_DIR/postgres/bin/pg_ctl" ]; then
        "$BASE_DIR/postgres/bin/pg_ctl" -D "$BASE_DIR/postgres/data" stop
    fi
    echo "Services stopped. System clear."
    exit 0
}

trap cleanup SIGINT SIGTERM

# Lock interactive terminal visibility loop
while true; do
    sleep 1
done
