#!/bin/sh
set -eu
unset NODE_PATH NODE_OPTIONS ELECTRON_RUN_AS_NODE
mkdir -p /tmp/uwork-runtime
chmod 700 /tmp/uwork-runtime
Xvfb :99 -screen 0 1440x1000x24 -nolisten tcp > /work/xvfb.log 2>&1 &
socat TCP-LISTEN:9333,bind=0.0.0.0,reuseaddr,fork TCP:127.0.0.1:9222 > /work/cdp-proxy.log 2>&1 &
if [ "${UWORK_LINUX_TEST_WINDOW_MANAGER:-0}" = 1 ]; then
  attempt=0
  until xdotool getdisplaygeometry >/dev/null 2>&1; do
    attempt=$((attempt + 1))
    [ "$attempt" -lt 50 ] || exit 1
    sleep .1
  done
  openbox --sm-disable > /work/openbox.log 2>&1 &
fi
if [ "${UWORK_LINUX_TEST_TRACE_LIFETIME:-0}" = 1 ]; then
  exec strace -D -ff -tt -e trace=process,signal -o /work/lifetime-strace dbus-run-session -- node /opt/backend/probe/backend.mjs
fi
exec dbus-run-session -- node /opt/backend/probe/backend.mjs
