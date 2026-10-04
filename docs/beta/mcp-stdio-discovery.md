# Trusted local stdio discovery

The internal stdio adapter starts a trusted local server for catalog discovery.
It is a prerequisite for beta. It does not establish production isolation or authorize tool calls.
No public CLI command starts this adapter.

Stdio carries messages through process input and output.
The adapter follows the [MCP stdio framing rules](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports).
It supports initialization, the initialized notification, and bounded catalog pages.
Unexpected requests, notifications, malformed responses, and catalog changes stop discovery.

## Explicit host trust

The factory requires `trustedLocalServerOnly: true`.
This declaration records a host precondition. It is not a sandbox or a security approval.
Use only reviewed server code in a controlled local test environment until the containment gate passes.
A server can access the host filesystem and network with the parent account's rights.

The existing discovery controller still requires exact authenticated approval and durable intent before contact.
The proposal names the executable, measured entrypoints, arguments, working directory, and environment references.
The adapter measures approved files after private secret resolution and before process creation.
It refuses mismatches and symbolic paths. It does not invoke a shell.
The adapter starts with an explicit environment. The child runtime can add platform metadata after launch.
Loader-control variables remain refused, even when they appear in the approved references.

Preflight measurement compares bytes before process creation. It does not prove immutable execution.
Another process with the same account can replace a file after measurement.
Imported code, shared libraries, and files that the server reads remain outside the measured entrypoint set.
Production acceptance still requires a stronger launch boundary and native bypass tests.

## Limits and cleanup

The adapter bounds message sizes, total output, diagnostics, requests, and session time.
It exposes sanitized error codes. It never forwards raw process diagnostics or secret values.
A separate guardian owns the server process group and its deadline.
Close succeeds only after the guardian reports that the leader exited and the group disappeared.
The cleanup interval bounds observation. A short interval can report uncertainty while the guardian continues cleanup.
This behavior targets macOS and Linux. Windows support remains unclaimed.
A descendant can escape a process group. Group signaling does not prove complete descendant containment.
If the controller dies, its private channel closes and the guardian terminates the owned group.
The guardian enforces its own whole-second deadline if the controller stops responding.
The guardian rounds the remaining session budget up to whole seconds.
Its timer starts when it accepts the job. Guardian startup and message scheduling add time before that point.
This does not protect against simultaneous guardian failure or an escaped descendant.
CPU limits, memory limits, filesystem isolation, and network isolation remain separate work.

Failed or interrupted contact leaves the durable intent held for reconciliation.
The controller does not restart an uncertain process automatically.
A completed dispatch returns its saved result without starting another server.

## Evidence scope

The tests use new synthetic server code and cast-based dummy identities.
The composition test uses the dedicated PostgreSQL proof service on this Mac.
It observes approval and committed intent before secret resolution permits process creation.
It covers concurrent dispatch, changed entrypoint bytes, catalog drift, unexpected messages, process exit, and stop.
Tests inspect direct-child termination and prevent inherited environment values from reaching the fixture.

A separate PostgreSQL proof kills or suspends a synthetic controller after initialization.
It observes server exit and guardian termination before explicit recovery holds the uncertain intent.
A suspended parent can leave an exited guardian as a zombie until the parent resumes and reaps it.
Recovery grants no replay authority. The test does not start a replacement process.

The tests do not use an external MCP provider or a native agent session.
Both harness boundaries, trusted credential storage, durable revocation integration, and production isolation remain release gates.
The private artifact remains alpha-versioned until the beta release candidate is approved.
