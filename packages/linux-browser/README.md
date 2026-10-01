# Confined local Linux browser executor

`await LinuxBrowserExecutor.open(installation)` validates the operator-owned configuration and all pinned public runtime files. The returned `.manifest` contains canonical registered-test bytes; `execute(TestExecution, AbortSignal)` and `reap(operationId)` implement the controlled-test boundary. Use `open`, not the internal constructor. No worker-controlled shell, URL, selector, image, capability or browser argument is accepted.

The exact installation object is:

```json
{
  "format": "trellis/linux-browser-installation/v0.7-alpha",
  "stateRoot": "/absolute/private/controller-directory",
  "browserRoot": "/absolute/chrome-headless-shell-linux-arm64",
  "librariesRoot": "/absolute/pinned-library-directory"
}
```

Create stateRoot as a private, canonical, controller-owned0700 directory. The three paths must be distinct, non-overlapping, canonical absolute paths. This alpha implementation targets the proved local Mac/Docker Desktop Linux arm64 environment: `/usr/local/bin/docker`, context `desktop-linux`, the pinned cached Node image, CFT154.0.8037.92, and the bundled dependency inventory. There is no image pull, dependency installer, hosted browser, paid fallback or unsupported-platform negotiation. Runtime binaries and library licenses remain with their separately provisioned public packages; they are not vendored here. Keep their complete upstream distributions when provisioning.

The browser gets a fixed immutable HTML snapshot, a private64MiB scratch tmpfs, read-only root/input/public libraries, private IPC, no network and AF_UNIX-only socket creation, UID1000, no outer capabilities, no-new-privileges, and fixed CPU/memory/PID limits. Chromium's own sandbox remains enabled; renderer status must demonstrate its extra seccomp filter. CDP uses anonymous pipes. The four checks follow [the fixed UI contract](assets/craft-shop-contract.md). The implementation and browser/environment pins are bound into the manifest. The compiled implementation digest is included; rebuild changes can require a new manifest and graph approval.

A durable private operation directory is claimed once. The request is detached and validated before that claim; its path is metadata only. Files are written to internally fixed container paths. Every launch verifies the full runtime inventory again. A known returned container ID, nonce label and image reference establish cleanup ownership. A durable fence prevents late launch; cleanup uses that recorded ID only. After controller restart, `reap` can remove a previously recorded owned container. It never adopts a container by name or launches again. An uncertain create acknowledgement remains held for operator reconciliation. Cleanup failure rejects and retains evidence. The running container starts a total deadline before browser work, so normal controller death leaves a bounded runner; a stopped container may remain until explicit reap.

This relies on a trusted controller account, the Docker daemon and its Linux kernel. It is not protection against an attacker mutating controller-owned directories or daemon resources concurrently. Atomic journal writes are synced, but there is no filesystem/Docker transaction. A daemon failure may require reconciliation. No arbitrary PID adoption, host sandbox bypass, general browser transport, persistent user profile, or unrestricted web browsing is supported.

`npm run test:linux-browser` runs fake-Docker tests without a Docker launch. To also validate the exact provisioned runtime assets, set `TRELLIS_BROWSER_ASSETS` to the prepared Linux proof packet01 directory. A real lifecycle probe is separately reviewed before execution; unit tests do not establish browser compatibility. Original proof04 passed four UI criteria, seven boundary probes, renderer seccomp evidence and owned cleanup. Packaging adds durable ownership and an earlier total deadline; its real acceptance is separately recorded.
