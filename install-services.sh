#!/bin/bash

# 1. Enforce administrative execution privileges
if [ "$EUID" -ne 0 ]; then
  echo "[CRITICAL ERROR] Please execute this script with sudo or root privileges!"
  exit 1
fi

# 2. Resolve environment location tracks dynamically
BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NODE_PATH=$(which node)
SERVER_PATH="$BASE_DIR/backend/src/server.js"

# Capture the real human user behind sudo to avoid running the backend daemon as root
REAL_USER=${SUDO_USER:-$USER}

echo "==================================================="
echo "  ZSecTools - Linux Native Systemd Service Deployment"
echo "==================================================="
echo "[INFO] Detected Application Root: $BASE_DIR"
echo "[INFO] Native Node.js Executable Path: $NODE_PATH"
echo "[INFO] Targeted Execution User: $REAL_USER"

# 3. DYNAMIC GENERATION OF BACKEND CONTROLLER SERVICE (DEPENDS ON NATIVE POSTGRESQL)
echo "[INFO] Provisioning zsectools-backend.service..."

cat <<EOF > /etc/systemd/system/zsectools-backend.service
[Unit]
Description=ZSecTools Backend Service Orchestrator
After=network.target postgresql.service
Requires=postgresql.service

[Service]
Type=simple
WorkingDirectory=$BASE_DIR
ExecStart=$NODE_PATH $SERVER_PATH
Restart=always
RestartSec=10
StandardOutput=syslog
StandardError=syslog
SyslogIdentifier=zsectools-backend
User=$REAL_USER

[Install]
WantedBy=multi-user.target
EOF

# 4. ENFORCE SECURE PERMISSIONS ON GENERATED MANIFEST
chmod 644 /etc/systemd/system/zsectools-backend.service

# 5. RELOAD SYSTEMD MANAGER CORE CONFIGURATION
echo "[INFO] Reloading systemd manager daemon configuration..."
systemctl daemon-reload

# 6. ENABLE AUTOMATIC BOOT STATE FOR NATIVE BACKEND
echo "[INFO] Enabling background unit for automatic system boot..."
systemctl enable zsectools-backend.service

# 7. IGNITE SERVICE IMMEDIATELY
echo "[INFO] Booting backend service into background execution context..."
systemctl start zsectools-backend.service

echo "==================================================="
echo "  Linux service provisioning finalized successfully!"
echo "  Application is up and available on http://localhost:3000"
echo "  Verify active states via: systemctl status zsectools-backend"
echo "==================================================="
