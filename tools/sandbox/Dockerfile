# Test tooling, never shipped. The image that runs every gate of the repository away from the host (docs/v0.9/sandbox-tests.md).
# The source is copied in. Nothing from the host is mounted at run time. The image runs as root on purpose, so that the
# machine-dependent tests (root owner, case-sensitive disk, long path) run and do not skip.
# The tag and the digest were checked on Docker Hub on 2026-11-10. The digest holds the exact image if the tag moves.
FROM node:24.21.0-bookworm@sha256:3d27e5c11e5786e309ec3e03f93ae536eb36e6e5eb3714d5eb3300a36157add0

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
# So a wrapper next to the binary adds the flag, and path.txt (which names the binary for `require('electron')` and for tools/run.mjs) points at the wrapper.
# The real binary keeps its name `electron`: Electron decides app.isPackaged from that name, and a binary renamed to anything else counts as a packaged app,
# which sends the app to look for its kits in the wrong folder. The wrapper changes no file of the repository.
RUN cd apps/desktop && node_modules/.bin/install-electron
RUN set -eu; dir=apps/desktop/node_modules/electron; \
    printf '#!/bin/sh\nexec "%s" --no-sandbox "$@"\n' "/work/$dir/dist/electron" > "$dir/dist/electron-no-sandbox"; chmod 755 "$dir/dist/electron-no-sandbox"; \
    printf 'electron-no-sandbox' > "$dir/path.txt"

ENV BOWERLOOM_SANDBOX=1
CMD ["sh", "tools/sandbox/in-container.sh"]
