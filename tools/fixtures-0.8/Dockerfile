# Test tooling, never shipped. The image that makes the frozen 0.8 install fixtures (tests/fixtures/install-0.8) with make.mjs.
# It starts from the same pinned Node image as tools/sandbox/Dockerfile. It holds no repository code and installs nothing at build time.
# Unlike the gate sandbox, it runs as the image's non-root user, so the owner and mode checks of the state folder behave as they do on a
# person's computer. The tag and the digest were checked on Docker Hub on 2026-11-10.
FROM node:24.21.0-bookworm@sha256:3d27e5c11e5786e309ec3e03f93ae536eb36e6e5eb3714d5eb3300a36157add0

# The image's non-root user is `node`. Nothing below needs root.
USER node
WORKDIR /home/node
# make.mjs mounts a new named volume here. The folder is made now so that the volume is owned by the non-root user.
RUN mkdir -p /home/node/work

COPY --chown=node:node in-container.sh /home/node/in-container.sh
RUN chmod 755 /home/node/in-container.sh

# XDG_STATE_HOME, BOWERLOOM_GITHUB_TOKEN, and BOWERLOOM_EVENT_LOG are not set here. in-container.sh unsets them, so the state folder takes
# its default place and the usage log is on.
ENTRYPOINT ["/home/node/in-container.sh"]
