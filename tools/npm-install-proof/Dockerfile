# Test tooling, never shipped. The image of the sandbox proof of npm installs (docs/v0.9/npm-install-proof.md).
# It starts from the same pinned Node image as tools/sandbox/Dockerfile, runs as the image's non-root user, and holds no repository
# code: only the three files of the proof itself. It installs nothing at build time.
# The tag and the digest were checked on Docker Hub on 2026-11-10.
FROM node:24.21.0-bookworm@sha256:3d27e5c11e5786e309ec3e03f93ae536eb36e6e5eb3714d5eb3300a36157add0

USER node
WORKDIR /home/node
# run.mjs mounts a new named volume here. The folder is made now so that the volume is owned by the non-root user.
# One volume holds the whole run: image layers sit on an overlay file system, which changes the folder identities that the 0.8
# command line pins between a plan and its approval.
RUN mkdir -p /home/node/work

COPY --chown=node:node run.mjs registry.mjs /home/node/proof/
COPY --chown=node:node standin /home/node/proof/standin

# No credential is set here, and none is passed at run time.
ENTRYPOINT ["node", "/home/node/proof/run.mjs"]
