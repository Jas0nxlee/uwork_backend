#!/bin/sh
set -eu
unset NODE_PATH NODE_OPTIONS ELECTRON_RUN_AS_NODE
mkdir -p /work/home /work/config /work/cache /work/share /work/project /work/extract /tmp/uwork-runtime
chmod 700 /tmp/uwork-runtime
Xvfb :99 -screen 0 1440x1000x24 -nolisten tcp > /work/xvfb.log 2>&1 &
socat TCP-LISTEN:9333,bind=0.0.0.0,reuseaddr,fork TCP:127.0.0.1:9222 > /work/cdp-proxy.log 2>&1 &
export ZCODE_DATA_BASE_DIR=/work/home UWORK_DATA_BASE_DIR=/work/home
export ZCODE_STORAGE_DIR=/work/home/.uwork ZCODE_DESKTOP_HOME_DIR=/work/home
export ZCODE_DESKTOP_USER_DATA_DIR=/work/userdata ZCODE_DESKTOP_SESSION_DATA_DIR=/work/sessiondata
export ZCODE_DISABLE_FIXED_REMOTE_DEBUGGING_PORT=1 ZCODE_ENV=production
export ZCODE_BASE_URL=http://127.0.0.1:9 ZCODE_UPDATE_FEED_URL=http://127.0.0.1:9/owned-no-updates
export ZCODE_ARMS_RUM_ENDPOINT='' APPIMAGE_EXTRACT_AND_RUN=1 TMPDIR=/work/extract
# No product sandbox-disabling switches: outer Docker seccomp is the only variable.
set +e
dbus-run-session -- /opt/artifacts/uwork-preview.AppImage \
  --disable-dev-shm-usage --disable-gpu --lang=zh-CN \
  --remote-debugging-port=9222 --open-workspace /work/project > /work/desktop.log 2>&1
code=$?
printf '%s\n' "$code" > /work/desktop-exit-code
exit "$code"
