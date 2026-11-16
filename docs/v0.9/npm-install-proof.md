# Sandbox proof of npm installs

This page says how to run the proof and how to read its result. The proof shows how npm handles two global packages before either one is released. The first is `bowerloom`, the final release, which forwards to `latebrake`. The second is `latebrake`.

Terms:

- A stand-in is a small test package that has the name and the commands of a real package, but not its code. The stand-in `latebrake` has three commands: `latebrake`, `latebrake-mcp`, and `latebrake-guard`. Each one is an echo probe. It writes its arguments and its standard input to stdout, a fixed line to stderr, and exits with the code that `--exit=N` sets.
- A static registry is a small local web server that serves package records and tarballs from files. It listens on 127.0.0.1 and answers GET only. Any other method gets 405.
- A tarball is the `.tgz` file that `npm pack` makes and `npm install` reads.

The proof publishes nothing. It runs no `npm` command that writes to a registry, and it sets no credential.

## What runs

The files are in `tools/npm-install-proof/`:

- `Dockerfile`: the pinned Node image of the gate sandbox, a non-root user, and no repository code.
- `run.mjs`: the driver, with a container mode and a host mode.
- `registry.mjs`: the static registry.
- `standin/latebrake/`: the stand-in.

The run has two phases.

1. Fetch, with the network on. `npm pack bowerloom@0.8.0-beta.1` downloads the real 0.8 tarball, and the proof checks it against the integrity that the registry lists. A real 0.8 run then makes a project, a store, and a private state folder in an owner-only HOME. This needs the pinned skill from registry.npmjs.org. These are the only reads from the network.
2. Run, with no network. In container mode the container runs with `docker run --network none`. In host mode the npm proxy settings point at a closed local port. Each case starts clean. It has an empty prefix, an empty cache, empty npm settings files, and a new HOME. It installs from the static registry with `--registry`.

## How to run it

Container mode needs Docker. Run it from the repository root:

```
node tools/npm-install-proof/run.mjs --out <new folder> --final-bowerloom-tarball <file>
```

- `--out` names a folder that does not exist yet, or is empty, outside the repository. The result is `result.json` in it.
- `--final-bowerloom-tarball` is the final `bowerloom` package, made with `npm pack` of `tools/final-bowerloom/package`. Without it, C5, C6, C8, C10, and C11 report "not run".
- `--latebrake-tarball` is the real `latebrake` package. Its hash is recorded. It is not used yet, and C14 reports "not run".
- `--mode host` runs on the computer itself, in a temporary folder with its own prefix, cache, and HOME. `--keep` leaves the Docker volume for a look.

The driver removes its Docker volume at the end. Its image tag is `bowerloom-proof-node:dev`.

The proof is not part of `npm test`, because it needs Docker and one registry read. `tools/test/npm-install-proof.test.mjs` runs in `npm test` with no network. It tests the static registry and the stand-in. If any file of the proof holds a command that writes to a registry, the test fails.

## How to read the result

`result.json` holds these parts:

- The Node and npm versions.
- The hash of each tarball.
- The packages that the registry served.
- A summary count.
- Each check.
- The log of every command.

Each check has three fields. `status` is `pass`, `fail`, or `not run`. `detail` is one sentence. `observed` holds what npm printed and what the prefix looked like. A `fail` that comes from the product behaving differently than expected is a finding, and the check is not changed to fit.

| Check | What it shows |
|---|---|
| C1 | The 0.8 tarball matches the registry integrity, and its `bin` names the three old commands. |
| C2 | 0.8 alone: three links into `lib/node_modules/bowerloom`, and `bowerloom --version` names 0.8.0-beta.1. |
| C3 | 0.8, then `latebrake`: six links, each into its own package, none replaced. |
| C4 | `latebrake`, then 0.8: the same. |
| C5 | Upgrade from 0.8 with `npm install -g bowerloom@latest`. The three old links point at the shims. It records whether npm linked any `latebrake` command from the nested copy. Each old command forwards stdout bytes, exit code, and standard input as a direct run does. |
| C6 | The final `bowerloom` beside a global `latebrake`, in both orders. The old commands run the nested copy, and the version each probe prints says which copy ran. |
| C7 | One command name in two packages. It records whether npm refuses, replaces the link, or needs `--force`, and what it prints. If the record is complete and the prefix is whole, the check passes. |
| C8 | Uninstall in each order. No step leaves a link that points nowhere, and removing both leaves an empty `bin` and `lib/node_modules`. |
| C9 | A real 0.8 run makes the project, store, and state trees. Their hashes, and the whole HOME, do not change across the npm steps. |
| C10 | Through the shims, the MCP command, the guard command, and `context guard` add no byte to stdout and print no notice. |
| C11 | The proof removes the nested `latebrake` entry file. Then the guard prints one deny line and exits 0. `context guard` exits 2 with empty stdout. The MCP command exits non-zero with empty stdout. |
| C12 | The run phase made no request to any host but 127.0.0.1, and a read of a real host failed. |
| C13 | Every npm command was a pack, install, uninstall, view, ls, or version command. No child process had an environment name beyond PATH, HOME, LANG, and npm settings. |
| C14 | The byte test with the real `latebrake` code. It does not run yet. It reports "not run" by design. |

C6 runs both orders. Its entry holds both results.

## Limits

- The stand-in has no real `latebrake` code. A shim and a direct run are compared on the stand-in only.
- The proof cannot press a terminal. The notice that the `bowerloom` command prints at a terminal is tested in `tools/test/final-bowerloom.test.mjs`, not here.
- The container runs Linux. Command links and file modes can differ on macOS, which is why host mode exists.
