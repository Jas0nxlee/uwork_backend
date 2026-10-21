FROM uwork-linux-desktop-test:20261020-v2
COPY uwork-preview.deb /tmp/uwork-preview.deb
RUN apt-get update && apt-get install -y --no-install-recommends /tmp/uwork-preview.deb \
    && dpkg-query -W zcode-preview \
    && rm -f /tmp/uwork-preview.deb && rm -rf /var/lib/apt/lists/*
