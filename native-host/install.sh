#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOST_NAME="com.oyecollective.chouette"

INSTALL_DIR="$HOME/.chouette/native-host"
CACHE_DIR="$HOME/.chouette/models"

# Detect Chrome variant manifest directories
MANIFEST_DIRS=()
for dir in \
  "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts" \
  "$HOME/Library/Application Support/Google/Chrome Canary/NativeMessagingHosts" \
  "$HOME/Library/Application Support/Chromium/NativeMessagingHosts"; do
  if [ -d "$(dirname "$dir")" ]; then
    MANIFEST_DIRS+=("$dir")
  fi
done

if [ ${#MANIFEST_DIRS[@]} -eq 0 ]; then
  echo "Error: No supported Chrome installation found."
  exit 1
fi

# Extension ID — override with: CHOUETTE_EXTENSION_ID=abc ./install.sh
EXTENSION_ID="${CHOUETTE_EXTENSION_ID:-}"
if [ -z "$EXTENSION_ID" ]; then
  echo "Usage: CHOUETTE_EXTENSION_ID=<your-extension-id> $0"
  echo ""
  echo "To find your extension ID:"
  echo "  1. Open chrome://extensions"
  echo "  2. Enable Developer Mode"
  echo "  3. Copy the ID shown under the Chouette extension"
  exit 1
fi

# Create directories
mkdir -p "$INSTALL_DIR"
mkdir -p "$CACHE_DIR"

# Install host script
cp "$SCRIPT_DIR/chouette_host.py" "$INSTALL_DIR/chouette_host.py"
chmod +x "$INSTALL_DIR/chouette_host.py"

# Install manifest to each detected browser
for MANIFEST_DIR in "${MANIFEST_DIRS[@]}"; do
  mkdir -p "$MANIFEST_DIR"
  cat > "$MANIFEST_DIR/$HOST_NAME.json" << EOF
{
  "name": "$HOST_NAME",
  "description": "Chouette translation model cache proxy",
  "path": "$INSTALL_DIR/chouette_host.py",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://$EXTENSION_ID/"
  ]
}
EOF
  echo "  Manifest: $MANIFEST_DIR/$HOST_NAME.json"
done

echo ""
echo "Installed native messaging host:"
echo "  Host script: $INSTALL_DIR/chouette_host.py"
echo "  Cache dir:   $CACHE_DIR"
echo ""
echo "To uninstall: $SCRIPT_DIR/uninstall.sh"
