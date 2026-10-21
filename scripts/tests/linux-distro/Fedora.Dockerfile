ARG DISTRO_BASE
FROM ${DISTRO_BASE}
COPY --from=node:24.14.0-bookworm-slim /usr/local/bin/node /usr/local/bin/node
COPY --from=uwork-backend:user-journey-20261017 /app/node_modules /opt/backend/node_modules
COPY uwork-preview.rpm /tmp/uwork-preview.rpm
RUN dnf -y install /tmp/uwork-preview.rpm \
      dbus-daemon dbus-x11 xorg-x11-server-Xvfb xorg-x11-xauth \
      xprop xdotool openbox socat git openssl procps-ng xdg-utils \
      dejavu-sans-fonts python3 \
    && rpm -q zcode-preview \
    && useradd --uid 1000 --create-home uwork-test \
    && rm -f /tmp/uwork-preview.rpm && dnf clean all
ENV DISPLAY=:99 HOME=/work/home XDG_CONFIG_HOME=/work/config \
    XDG_CACHE_HOME=/work/cache XDG_DATA_HOME=/work/share \
    XDG_RUNTIME_DIR=/tmp/uwork-runtime NODE_PATH=/opt/backend/node_modules
