ARG DISTRO_BASE
FROM ${DISTRO_BASE}
COPY --from=node:24.14.0-bookworm-slim /usr/local/bin/node /usr/local/bin/node
COPY --from=uwork-backend:user-journey-20261017 /app/node_modules /opt/backend/node_modules
COPY uwork-preview.pkg.tar.zst /tmp/uwork-preview.pkg.tar.zst
# Repository packages remain signed. The local UWork development artifact is
# unsigned, using the distribution's documented Optional local-file policy.
# Landlock restrict_self requires no-new-privileges with Docker's bounded root capabilities.
# Strengthen only the pacman process; keep its original download sandbox and signature checks.
# Serial transport avoids observed concurrent small-signature stalls; timeout and validation stay unchanged.
# One bounded retry shares the normal download cache after a mirror timeout; no validation/timeout is disabled.
RUN printf '%s\n' 'Server = https://ca.us.mirror.archlinuxarm.org/$arch/$repo' > /etc/pacman.d/mirrorlist \
    && sed -i 's/^ParallelDownloads = 5$/ParallelDownloads = 1/' /etc/pacman.conf \
    && pacman-key --init \
    && pacman-key --populate archlinuxarm \
    && (for uwork_download_attempt in 1 2; do \
          if setpriv --no-new-privs pacman -Syu --noconfirm \
            dbus xorg-server-xvfb xorg-xauth xorg-xprop xdotool openbox socat \
            git openssl procps-ng xdg-utils ttf-dejavu python \
            gtk3 nss libxss libxtst libnotify alsa-lib mesa; then exit 0; fi; \
        done; exit 1) \
    && setpriv --no-new-privs pacman -U --noconfirm /tmp/uwork-preview.pkg.tar.zst \
    && pacman -Q zcode-preview \
    && test "$(id -u alarm)" = 1000 \
    && rm -f /tmp/uwork-preview.pkg.tar.zst \
    && pacman -Scc --noconfirm
ENV DISPLAY=:99 HOME=/work/home XDG_CONFIG_HOME=/work/config \
    XDG_CACHE_HOME=/work/cache XDG_DATA_HOME=/work/share \
    XDG_RUNTIME_DIR=/tmp/uwork-runtime NODE_PATH=/opt/backend/node_modules
