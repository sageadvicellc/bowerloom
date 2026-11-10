# Test tooling, never shipped. The image that runs every gate of the repository away from the host (docs/v0.9/sandbox-tests.md).
# The source is copied in. Nothing from the host is mounted at run time. The image runs as root on purpose, so that the
# machine-dependent tests (root owner, case-sensitive disk, long path) run and do not skip.
FROM node:24.21.0-bookworm

ENV DEBIAN_FRONTEND=noninteractive
# Electron and Chromium need these libraries. xvfb gives the e2e run a screen that lives only in the container.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
    xvfb xauth git ca-certificates fonts-liberation \
    libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libgbm1 libgtk-3-0 libasound2 \
    libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 libxfixes3 libxtst6 libx11-xcb1 \
    libpango-1.0-0 libcairo2 libdbus-1-3 libxss1 \
 && apt-get clean

WORKDIR /work
COPY . /work

# Install from the lock files, as the gates expect. The network is needed here, at build time, and not at run time.
RUN npm ci && npm --prefix apps/desktop ci

# Electron 44 has no install script. Its binary comes from `install-electron`, which needs the network, so it runs now at build time.
# Electron also refuses to start as root without --no-sandbox, and the e2e specs start the binary themselves.
# The wrapper adds the flag inside the image only. It changes no file of the repository.
RUN cd apps/desktop && node_modules/.bin/install-electron
RUN set -eu; bin=apps/desktop/node_modules/electron/dist/electron; mv "$bin" "$bin.real"; \
    printf '#!/bin/sh\nexec "%s.real" --no-sandbox "$@"\n' "/work/$bin" > "$bin"; chmod 755 "$bin"

ENV BOWERLOOM_SANDBOX=1
CMD ["sh", "tools/sandbox/in-container.sh"]
