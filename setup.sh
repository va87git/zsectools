#!/bin/bash
set -e

# Strip trailing slashes and lock the absolute directory context
BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==================================================="
echo "  ZSecTools - Linux System Native Environment Setup"
echo "==================================================="

# 1. ENFORCE ADMINISTRATIVE PRIVILEGES FOR PACKAGE INSTALLATION
if [ "$EUID" -ne 0 ]; then
  echo "[CRITICAL ERROR] Please execute setup.sh with sudo or root privileges!"
  exit 1
fi

# 2. UPDATE SYSTEM REPOSITORIES AND INSTALL NATIVE DEPENDENCIES
echo "[INFO] Updating package lists and installing Node.js and PostgreSQL via APT..."
apt update -y
apt install -y nodejs npm postgresql postgresql-contrib

# 3. INSTALL BACKEND DEPENDENCIES
echo "[INFO] Installing backend dependencies..."
cd "$BASE_DIR/backend"
npm install --ignore-scripts

# 4. INSTALL FRONTEND DEPENDENCIES AND BUILD
echo "[INFO] Installing frontend dependencies and building production assets..."
cd "$BASE_DIR/frontend"
npm install
npm run build
cd "$BASE_DIR"

# 5. INITIALIZE NATIVE POSTGRESQL DATABASE CONTEXT
echo "[INFO] Setting up database prerequisites..."
if [ ! -f "$BASE_DIR/pwfile.txt" ]; then
    echo "[WARN] pwfile.txt missing! Generating default credentials..."
    echo "apppassword" > "$BASE_DIR/pwfile.txt"
fi

DB_PASSWORD=$(cat "$BASE_DIR/pwfile.txt")

# Configure the native system PostgreSQL instance
echo "[INFO] Configuring PostgreSQL native user and application database..."
sudo -u postgres psql -c "ALTER USER postgres PASSWORD '$DB_PASSWORD';"
sudo -u postgres psql -c "CREATE USER appuser WITH PASSWORD '$DB_PASSWORD';" 2>/dev/null || echo "[INFO] User appuser already exists."
sudo -u postgres psql -c "ALTER USER appuser WITH SUPERUSER;"
sudo -u postgres psql -c "CREATE DATABASE appdb OWNER appuser;" 2>/dev/null || echo "[INFO] Database appdb already exists."

echo "==================================================="
echo "  Linux native setup routine finalized successfully!"
echo "==================================================="
