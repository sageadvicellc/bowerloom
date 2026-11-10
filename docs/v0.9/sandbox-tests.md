# Run the tests in a sandbox

One command runs every gate inside a Linux container. No test runs on your computer.

```
npm run sandbox:test
```

When the run ends, you can copy its records to a folder on your computer. Add `-- --out <folder>` to do so.

## What runs

The container runs these, in order:

1. Root typecheck.
2. Root tests.
3. Desktop typecheck.
4. Desktop unit tests.
5. Desktop end-to-end tests, on a virtual screen that exists only in the container.
6. The four machine-dependent tests, with a short report of each.

Steps 1 to 5 are `node tools/gates.mjs --e2e`. The run stops at the first failed step.

## How it stays off your computer

- The command on your computer runs only `docker`.
- The source is copied into the image. The container mounts no folder from your computer, so no test can write there.
- The container publishes no port, has no network, and cannot reach the Docker socket.
- Your home folder is not mounted.
- The container runs as root. Root is what lets the four machine-dependent tests run instead of skip.
- At the end of the run, the command removes the container.

The network is on while the image builds, because the build installs the packages. It is off while the tests run.

## Start Docker first

If Docker is not running, the command stops and says so. Start Docker Desktop with `open -a Docker`. Wait until `docker info` works. Then run the command again.

## The four machine-dependent tests

Each skips on macOS and runs in the container:

- The path of more than 1024 bytes, in `registered-folders.test.mjs`.
- The case-sensitive P6 check, in `portable-review.test.mjs`.
- L5, the alias of `.bowerloom`, in `discovery.test.mjs`.
- The real owner check, in `remove-cache.test.mjs`.

## What cannot run here

The container is Linux. These stay skipped, and the run says so:

- The packaged-app spec, because it needs a macOS build.
- The check of the Electron fuses on a built app.
- The launch of a macOS build.

For a root user, a few tests skip, such as the checks that a file with mode 000 cannot be read. Those skip in the container for that reason. They run on the host.

## Rebuild

The command builds the image each time. Docker reuses the layers that did not change.

## First full run

The first full run in the container, on 2026-11-10, did not pass. It found these:

- Root typecheck and desktop typecheck passed.
- Root tests: 5830 passed, 159 failed, 104 skipped.
- Desktop unit tests: 1959 passed, 17 failed, 4 skipped.
- Desktop end-to-end tests: 269 passed, 11 failed, 23 skipped.
- The four machine-dependent tests all passed.

The failures have three causes that the run showed:

- Code that reads the macOS boot session fails on Linux. It breaks the MCP container tests and the Codex guardian tests.
- Tests that expect a permission error fail for root, because root can read and delete anything. These are the mode 0 and cannot-delete tests.
- Some end-to-end specs fail on Linux. Two call a macOS menu function that Linux does not have. Others time out on the virtual screen, or fail to start Electron.

The other failures are not yet diagnosed. A decision on how to treat them belongs to the maintainer.

## If the build hangs

Docker Desktop can hang on its credential helper when the build pulls the base image. The command then prints nothing after "load metadata". Run the command with an empty Docker config folder that links to the same plug-ins and the same socket.
