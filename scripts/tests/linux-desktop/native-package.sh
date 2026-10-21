#!/bin/sh
set -eu
unset NODE_PATH NODE_OPTIONS ELECTRON_RUN_AS_NODE
mkdir -p /app
tar -xzf /input/desktop.tar.gz -C /app --no-same-owner
if [ "$#" -gt 0 ]; then
  case "$1" in AppImage|deb|rpm|pacman) ;; *) exit 2 ;; esac
  exec /opt/builder/node_modules/.bin/electron-builder --config electron-builder.config.js --linux "$1" --arm64 --prepackaged /app --publish never
fi
exec /opt/builder/node_modules/.bin/electron-builder --config electron-builder.config.js --linux --arm64 --prepackaged /app --publish never
