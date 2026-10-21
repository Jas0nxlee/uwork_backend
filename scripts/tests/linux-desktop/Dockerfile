FROM node:24.14.0-bookworm-slim
COPY --from=uwork-backend:user-journey-20261017 /app/node_modules /opt/backend/node_modules
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgtk-3-0 libnss3 libxss1 libasound2 libgbm1 libatk-bridge2.0-0 \
    libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 \
    libxfixes3 libxcursor1 libxtst6 libx11-xcb1 \
    dbus-x11 xvfb xauth socat fonts-noto-cjk openssl git procps curl \
    && rm -rf /var/lib/apt/lists/*
ENV DISPLAY=:99 HOME=/work/home XDG_CONFIG_HOME=/work/config \
    XDG_CACHE_HOME=/work/cache XDG_DATA_HOME=/work/share XDG_RUNTIME_DIR=/tmp/uwork-runtime
ENV NODE_PATH=/opt/backend/node_modules
