FROM uwork-linux-desktop-test:20261020-v2
RUN apt-get update && apt-get install -y --no-install-recommends binutils xz-utils rpm squashfs-tools desktop-file-utils \
    && rm -rf /var/lib/apt/lists/*
RUN npm install --prefix /opt/builder --no-audit --no-fund --ignore-scripts electron-builder@26.8.1
COPY project/ /workspace/
RUN ln -s /opt/builder/node_modules /workspace/clients/uwork/node_modules
WORKDIR /workspace/clients/uwork/packages/desktop
ENV ZCODE_ENV=production ZCODE_PREVIEW_IDENTITY=1 ZCODE_TARGET_OS=linux ZCODE_TARGET_ARCH=arm64 \
    ZCODE_DESKTOP_DIST_DIR=/output
RUN npm install --prefix /opt/builder --no-audit --no-fund --ignore-scripts tsx@4.21.0 zod@4.6.5 \
    && mkdir -p /opt/builder/node_modules/@zcode \
    && for name in provider provider-node shared model-option-map; do ln -s "/workspace/clients/uwork/packages/$name" "/opt/builder/node_modules/@zcode/$name"; done
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates zstd libarchive-tools \
    && update-ca-certificates && rm -rf /var/lib/apt/lists/*
