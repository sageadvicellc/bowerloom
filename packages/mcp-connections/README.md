# MCP connection planning

This package prepares private plans from three selected JSON files. It starts no process, connection, model, or tool.
MCP connects agents to tools. This package records proposed connections without operating them.

## Input files

- A portable declaration lists a logical connection, transport, protocol version, tools, and operator-selected permission classes.
- A private binding names a server, an executable or HTTPS endpoint, and secret references.
- A recorded catalog supplies synthetic tool names, schemas, descriptions, and annotations for that binding.

All three documents use closed versioned envelopes. The supported protocol identifier is `2025-11-25`.
A catalog must name the exact revision of its binding. That match proves consistency between supplied records, not server authenticity.
The `synthetic` field records the caller's assertion. It does not prove the origin or sensitivity of the input.

Portable declarations contain no machine paths, endpoints, credentials, or secret references.
Private stdio bindings contain an absolute executable path, working directory, and environment-variable secret references.
This version accepts no free-form arguments or environment values.
Private HTTP bindings contain one canonical HTTPS endpoint and either no authentication or declared OAuth metadata.
OAuth metadata includes an issuer, audience, scopes, and a credential reference.
A reference has the form `secret-ref:synthetic/labs-access`. The planner does not resolve it.

The parser refuses unknown fields, inline token fields, headers, passwords, and ambiguous URLs.
These structural limits do not sanitize arbitrary text. Treat the selected input files and every plan as private.

## Public API

`planMcpConnection` accepts `{declaration, binding, catalog, synthetic: true}` as plain JSON data.
It rejects accessors, custom prototypes, serialization hooks, cycles, and inputs beyond the fixed size and complexity limits.
`validateMcpDeclaration` and `validateMcpBinding` return normalized copies.
`mcpBindingRevision` returns the exact revision for a valid binding.

`planMcpConnectionFiles` accepts `{declarationFile, bindingFile, catalogFile, synthetic: true}`.
Each path must identify a selected absolute JSON file.
Binding and catalog files must have owner-only access inside owner-only directories.
The declaration can permit read access for other users, but it cannot permit writes by them.
The wrapper refuses symbolic links, hard links, unsafe owners, unsafe modes, protected credential paths, and observed source changes.
It reads each selected file again before returning the plan. These observations do not lock files against later changes.

The pure plan pins the complete catalog, each schema, the binding, and the declared permission classes.
The file plan also pins file bytes and local identities. Its `contentRevision` identifies the corresponding pure plan.
Neither plan includes tool descriptions, annotations, schema defaults, or examples as visible content.
Changes to that omitted content still change the catalog revision.

Descriptions and annotations never choose a permission class. The operator declares each class in the portable declaration.
The planner does not prove that a tool behaves according to its declared class.
Schema handling bounds and pins the recorded JSON. It requires object roots, but does not perform full JSON Schema validation.

## Current limits

- The catalog is a supplied record, not authenticated discovery.
- No secret, token, issuer, audience, expiry, scope, or revocation state receives runtime validation.
- No plan grants tool access, writes files, changes a harness, or supplies execution approval.
- No gateway enforces the selected tool boundary in this package.
- Live stdio, Streamable HTTP, and two-harness execution remain unproven.

The synthetic fixtures illustrate the accepted shapes. Their executable paths and domains identify no operational service.

## Internal discovery session

`discoverMcpCatalog` compares a supplied catalog with a bounded session through a trusted transport factory.
It requires the exact pure plan revision before it calls the factory. The approval permits discovery only, not tool calls.
The factory receives a frozen copy of the binding, an abort signal, and a notification callback.
It supplies `initialize`, `initialized`, `listTools`, and `close` methods. The engine has no tool-call method.
The adapter handles JSON-RPC envelopes and returns result objects to the engine.

The engine initializes protocol `2025-11-25` with empty client capabilities.
It requires the recorded server name and version, plus a tools capability.
It then sends the initialized notification and requests each tools page.
Eight pages and 256 tools are the maximum. The combined page data cannot exceed 256 KiB.
The full tool catalog must match its recorded revision, including descriptions, annotations, and unselected tools.
The engine refuses every incoming notification during the session, including a changed-catalog notification.

The default session deadline is 5 seconds. Callers can select a deadline from 1 millisecond through 30 seconds.
Cleanup has a separate 1-second limit. A cleanup failure or timeout prevents a successful result.
If a factory resolves after cancellation, the engine attempts to close its returned transport once.
An unresolved factory or late cleanup does not prove that every resource stopped.
The trusted factory must honor cancellation and close all resources that it creates.

A successful result states that the catalog matched through the adapter and that its close method completed.
The result does not authenticate an arbitrary endpoint or validate OAuth tokens.
This internal engine supplies no production connector, CLI discovery command, gateway, or harness projection.
The trusted factory is host code with its existing authority. This interface is not a sandbox for that code.

## Internal resource-side token verification

`validateMcpAccessToken` performs resource-side verification of supplied synthetic tokens against an OAuth HTTP binding, trusted policy, and current revocation snapshot.
The caller supplies trusted time as `nowMs`. The function performs no file, network, process, or secret-resolution operation.
It uses `jose` to import local public keys and verify signatures.

This bounded profile accepts only `RS256`, the exact `at+jwt` type, and a selected `kid` identifier.
RSA public keys contain a modulus from 2048 through 4096 bits. The policy accepts at most eight public keys.
The validator rejects private key fields, symmetric keys, remote key URLs, extension headers, and duplicate key identifiers.
It parses bounded header and claim data before signature validation. Duplicate JSON keys and noncanonical base64url encoding fail.

The token requires one exact audience string, issuer, subject, client identifier, and scope set.
It also requires expiry, activation time, issue time, and a token identifier.
All binding scopes must appear exactly once. Extra scopes fail.
Token age and lifetime cannot exceed the trusted policy limits. Those limits cannot exceed one hour.
No clock tolerance applies.

The policy pins the binding revision, expected subject, client identifier, public keys, issuer, audience, and exact revocation revision and epoch.
`mcpRevocationRevision` computes the revision of a supplied snapshot.
The snapshot must match the binding, issuer, subject, and policy epoch.
It must remain current within the policy freshness limit, which cannot exceed five minutes.
A matching token identifier, subject, or key identifier in its revocation lists blocks validation.

The trusted host supplies a new policy pin when it accepts a new revocation snapshot.
An old snapshot fails against that updated policy.
This pure validator keeps no durable record that prevents rollback. The host must preserve its current policy and epoch separately.
Replaying a mutually old policy and snapshot remains outside that protection when their supplied time permits them.

The private result contains revision pins, the expected subject, key identifier, expiry, and validation time.
It contains no token, raw key, or token identifier. It grants no tool or effect authority.
This synthetic profile does not establish OAuth enrollment, key discovery, introspection, a real identity, or company-service readiness.
Opaque tokens and other token profiles are unsupported.

This verifier belongs on the resource side. It is not a requirement for outbound clients to inspect access tokens.
OAuth clients treat access tokens as opaque. [RFC 9068](https://www.rfc-editor.org/rfc/rfc9068.html#section-6) explains that boundary.
The required `client_id` claim follows [RFC 9068 section 2.2](https://www.rfc-editor.org/rfc/rfc9068.html#section-2.2).
This deliberately narrower synthetic profile does not claim full RFC compliance.

## Internal discovery authority

`DiscoveryAuthorityController` controls one discovery operation per task scope through a trusted transactional store.
The trusted host provisions a grant with the owner, approvers, owner epoch, ready time, and lease expiry.
An epoch identifies a grant generation. A changed epoch invalidates the earlier proposal.
`createDiscoveryProposal` pins the complete discovery input, timeout, scope, request, owner epoch, and execution envelope.

For stdio, the envelope pins the executable digest, entrypoint digests, exact arguments, working directory, and secret references.
It forbids inherited environment values. A trusted adapter must enforce that declaration when it starts the process.
For HTTP, the envelope pins the exact endpoint and authentication binding revision.
The adapter must remeasure native executable and entrypoint bytes before it starts them. This controller does not prove that step.
An approved executable is still host code. A digest does not establish safe behavior or a native sandbox.

The approver authenticates and approves the exact proposal revision with an expiry.
The owner authenticates before dispatch. The controller commits an `IN_FLIGHT` intent before it invokes any adapter.
It then repeats the authority checks under the same scope lock immediately before synchronous adapter invocation.
That lock defines the order between revocation and opening. The adapter returns its promise without delaying the callback.
Stores must never retry transaction callbacks automatically because that callback can invoke the adapter.

The record starts as `PREPARED`. Successful discovery and acknowledged cleanup can produce `COMPLETED` only through the controller.
A completed record returns its saved result without contacting the adapter again.
A stop before dispatch produces `CANCELLED`. A failed or uncertain session remains `NEEDS_RECONCILIATION`.
Restart recovery moves an `IN_FLIGHT` record into that held state. It does not contact the adapter.
There is no manual success-receipt API and no automatic retry of an uncertain operation.

Local stop and recovery requests abort the known active session after authenticating the caller and task scope.
They still request that abort if the store loses its commit acknowledgement.
A stop from another process fences later completion. It does not prove remote process termination without a supervisor or polling connection.
A lost completion acknowledgement requires inspection of durable state. It does not permit another dispatch.

The store validates closed state records and transitions, preserves immutable proposal history, and prevents terminal rollback.
Identity proofs, the store, clock, and adapter remain trusted host components.
This controller authorizes discovery contact only. It grants no tool call, native isolation, or public CLI execution authority.

## Internal HTTPS discovery adapter

`createMcpHttpDiscoveryFactory` supplies a real HTTPS adapter to `DiscoveryAuthorityController`.
It exposes only initialization, the initialized notification, tool listing, and local cleanup.
The exact endpoint and authentication binding revision must match the controller's approved effect envelope.
There is no public connect command, tool invocation method, or automatic retry.
The factory is trusted host code. Calling it directly does not create or verify an approval.

The adapter uses POST with JSON or finite Server-Sent Events responses.
It accepts at most ten requests per session: initialization, its notification, and up to eight catalog pages.
Every response is bounded to 256 KiB, with strict UTF-8 and duplicate-key JSON checks.
Request and session deadlines are bounded to at most thirty seconds.
The initialized notification requires an empty `202` response. Other requests require `200` and one exact JSON-RPC response.
Unknown envelopes, server requests, notifications, compression, redirects, authentication failures, session changes, and protocol changes fail closed.
The adapter reports server messages through the discovery callback; it never executes them or forwards their private payloads.

An optional session identifier comes only from the initialization response and is pinned for later requests.
Later requests include the fixed protocol version. Finite SSE supports comments, message events, and empty priming events.
It requires a complete stream with exactly one response. Retry directives, resumption, background GET streams, and session restart are unsupported.
Cleanup closes local requests and sockets. It sends no DELETE or remote cancellation and does not prove that the server cancelled its work.
This is a bounded subset of [MCP Streamable HTTP](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports), not full transport conformance.

Normal connections verify TLS with system trust and use no proxy environment configuration.
DNS is resolved once per session. Every returned address must pass conservative public IPv4 admission.
All IPv6 and special-use IPv4 ranges are refused in this slice, including mixed public/private DNS answers.
One admitted address is pinned for every connection while the original hostname remains the TLS identity.
No DNS resolver override is exposed. DNS queries already in progress cannot be cancelled, but late resolution cannot open a connection after cleanup.
For isolated synthetic proof, `loopbackTls: { endpoint, ca }` permits only the exact selected HTTPS URL with literal `127.0.0.1` and its supplied CA.
TLS verification remains enabled. That option is not a production private-network access policy.

The trusted host supplies `resolveCredential` for OAuth bindings.
Before each POST, the resolver must return an opaque token and matching binding revision, secret reference, issuer, audience, exact scopes, expiry, and revocation metadata.
The adapter checks those fields again and sends the token only as the authorization header to the pinned endpoint.
It never parses the token as a JWT, reads ambient credentials, logs credentials, or returns them in results and errors.
Credential metadata is a host assertion, not cryptographic verification, OAuth enrollment, key discovery, or introspection.
An uncooperative resolver cannot be cancelled internally; a late result is ignored after the bounded session ends.
Full OAuth enrollment, company service readiness, durable supervision, and native process isolation remain unproven.

## Internal trusted local stdio adapter

`createMcpStdioDiscoveryFactory` is a prerequisite for discovery through a trusted local executable.
The host must explicitly set `trustedLocalServerOnly: true` and provide a secret-reference resolver.
This flag records a host precondition. It does not make an arbitrary server safe or authorize it.
Use the factory through `DiscoveryAuthorityController` with a separately approved exact effect envelope.
There is no public CLI connection command, shell execution path, tool invocation method, or automatic retry.

The adapter matches the executable, working directory, and environment references to the binding.
It pins exact arguments and entrypoint digests from the approved envelope.
Each listed entrypoint must appear as an exact argument. Arguments receive no shell or PATH expansion.
All paths must be canonical and absolute. Preflight rejects symlinks in selected paths and their ancestors, nonregular files, hardlinked files, and group/world-writable executable or entrypoint files.
Executable measurement is bounded to 128 MiB and each entrypoint to 4 MiB.
All secrets resolve before measurement. The adapter hashes open files, checks metadata and named-file identity for drift, and measures immediately before spawning.

Preflight hashes do not make execution atomic. They cannot prevent concurrent replacement by another process with the same filesystem authority.
They do not pin imported files, dynamic libraries, runtime configuration, or code fetched by the trusted executable.
The server retains the host account's ambient filesystem and network access.
This adapter does not prove native bypass denial, a sandbox, CPU or memory limits, or production containment.
Those release gates remain open.

The child receives only explicitly resolved environment references, with no inherited environment.
Common loader and shell control names, including `NODE_OPTIONS`, `NODE_V8_COVERAGE`, `NODE_PATH`, `PATH`, `LD_*`, and `DYLD_*`, are refused.
The Node 24 parent coverage propagation path is explicitly suppressed with an own undefined environment property, which is omitted from the actual child environment.
A host running Node's permission model is unsupported in this slice because spawn can inject its permission flags into `NODE_OPTIONS`.
On macOS, the child runtime can add `__CF_USER_TEXT_ENCODING` after startup; this is not an inherited application setting. The adapter does not claim byte-exact runtime environment immutability.
This denylist is defense in depth for a trusted server, not complete control of every language runtime.
Resolved values remain private, bounded to 8 KiB each and 32 KiB total, and never appear in results or diagnostics.

Only initialization, its notification, and catalog listing can be written to stdin.
There are at most ten outbound messages per session. Replies must be strict newline-delimited UTF-8 JSON with an exact request identifier and closed JSON-RPC envelope.
Duplicate keys, unsolicited replies, server requests, notifications, partial output, and malformed data stop the session.
Server messages reach the discovery callback only as a fixed sanitized method marker.
Stdout is bounded to 512 KiB per session and 256 KiB per line. Stderr is discarded with a 16 KiB limit.
Request and session time limits are at most thirty seconds. No raw output or native error payload is returned.

On macOS and Linux, the adapter creates and owns one detached process group.
Stop, timeout, and close signal that group, destroy local pipes, and escalate to SIGKILL within a bounded cleanup interval.
Cleanup succeeds only after direct child exit is observed; otherwise it reports uncertainty.
This does not establish that descendants which escape the group were contained or terminated.
There is no Windows support in this slice.
The adapter does not use the separate Codex guardian. Host crashes and orphan cleanup remain unproved; these time limits are not durable across controller death.
Late secret resolution and cancelled queued work cannot spawn a child after the session closes.
