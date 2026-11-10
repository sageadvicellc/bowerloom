# Run the tests in a sandbox

One command runs every gate inside a Linux container. No test runs on your computer.

```
npm run sandbox:test
```

## Status today: this command exits 1

The command is not a pass or fail gate yet. It exits 1 today. The tests fail in the container for reasons that belong to Linux and to the root user. The section "First full run" lists them. Do not use the exit code as a release gate until those failures are settled.

## What runs

The container runs these steps. All of them run, also after a failure.

1. Root typecheck.
2. Root tests.
3. Desktop typecheck.
4. Desktop unit tests.
5. Desktop end-to-end tests, on a virtual screen that exists only in the container.
6. The four machine-dependent tests, with a short report of each.

Steps 1 to 4 run one at a time through `tools/gates.mjs`. Step 5 runs Playwright directly, with a limit of three hours. The gates tool stops an end-to-end step at 30 minutes, and a full run in the container takes longer. Each long command has its own time limit. A failed build, or a failed `npm run bundle` before the end-to-end step, stops nothing else. It fails the run and prints the end of its log.

Step 5 fails in these cases:

- `npm run bundle` fails, so Playwright does not start.
- Playwright exits with a code other than 0. Code 124 means the time limit stopped it.
- The report holds an error.
- A test was interrupted.
- The report holds fewer tests than the frozen end-to-end suite. That suite has 285 tests in `docs/v0.9/test-inventory.json`.
- The frozen count cannot be read. The summary then says "frozen count unavailable".

## How it stays off your computer

- The command on your computer runs only `docker`.
- The source is copied into the image. The container mounts no folder from your computer, so no test can write there.
- The container publishes no port, has no network, and cannot reach the Docker socket.
- Your home folder is not mounted.
- The container runs as root. Root is what lets the four machine-dependent tests run instead of skip.
- The container drops every capability except six: CHOWN, DAC_OVERRIDE, FOWNER, SETUID, SETGID and KILL. It blocks new privileges. It has a limit of 4096 processes and 8 GB of memory.
- The base image is pinned by tag and by digest.
- At the end of the run, the command removes the container. If the removal fails, the command prints a warning and the command to remove it yourself.

The network is on while the image builds, because the build installs the packages. It is off while the tests run.

## Options

- `--print-commands` prints the docker commands and runs nothing.
- `--out <folder>` copies the result files to a folder on your computer after the run.
- `BOWERLOOM_SANDBOX_LIMIT_SECONDS` sets the time limit of the whole container run. The default is 14400.

The `--out` folder must be a new folder, or an empty one. The command refuses these:

- A folder that holds files.
- `/` and your home folder.
- A link.
- A name that starts with a dash.
- A path with a `..` part.

A relative path counts from the folder where you run the command. The command checks the folder again right before the copy.

 It copies only the named result files, one by one, into a fresh folder inside `--out`. It removes any link or special file, then moves the files up.

The result files are `gates-<step>.json` for each of the four gates steps, `e2e.json`, `machine-dependent.jsonl`, and a `logs` folder.

Exit codes:

- 0: all steps passed.
- 1 or another code from the container: a step failed.
- 2: wrong use.
- 3: Docker is not available.
- 4: the image did not build.
- 5: the result files were not copied.
- 6: the time limit stopped the container.

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

## First full run

The first full run in the container, on 2026-11-10, did not pass. It found these:

- Root typecheck and desktop typecheck passed.
- Root tests: 5830 passed, 159 failed, 104 skipped.
- Desktop unit tests: 1959 passed, 17 failed, 4 skipped.
- Desktop end-to-end tests: 269 passed, 11 failed, 23 skipped.
- The four machine-dependent tests all passed.

The root log counts 159 failures. It holds 139 different test names, because some tests fail and run again. The causes below count different names, by the error code or by words in the test name:

- Root, 72 tests: code that reads the macOS boot session fails on Linux. They show the error codes `MCP_GUARDIAN_BOOT_UNKNOWN`, `MCP_RECOVERY_COLLECTOR_UNCERTAIN` or `STARTUP_VALIDATION`.
- Root, 14 tests, and desktop, 4 tests: tests that expect a permission error fail for root, because root can read and delete anything. These are the mode 0 and cannot-delete tests.
- Root, 53 tests, and desktop, 13 tests: not sorted by cause yet. Some could also be root effects. This run did not find out.
- End-to-end, 11 tests: two call a macOS menu function that Linux does not have. The rest time out on the virtual screen, close the page, fail to start Electron, or fail an assertion. This run did not sort them further.

A decision on how to treat these failures belongs to the maintainer.

## If the build hangs

The credential helper of Docker Desktop can hang while the build pulls the base image. The command then prints nothing after "load metadata". Run the command with an empty Docker config folder that links to the same plug-ins and the same socket.
