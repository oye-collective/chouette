#!/bin/bash
set -euo pipefail

HOST_NAME="com.oyecollective.chouette"

# Remove manifests from all known locations
for dir in \
  "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts" \
  "$HOME/Library/Application Support/Google/Chrome Canary/NativeMessagingHosts" \
  "$HOME/Library/Application Support/Chromium/NativeMessagingHosts"; do
  if [ -f "$dir/$HOST_NAME.json" ]; then
    rm -f "$dir/$HOST_NAME.json"
    echo "Removed: $dir/$HOST_NAME.json"
  fi
done

# Remove host script
rm -rf "$HOME/.chouette/native-host"

echo ""
echo "Native messaging host uninstalled."
echo "Cached models remain at ~/.chouette/models/ (remove manually if desired)."
