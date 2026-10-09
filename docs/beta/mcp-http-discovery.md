# HTTPS discovery

The internal HTTPS adapter contacts an approved MCP endpoint through the discovery authority controller.
It exposes initialization and tool listing. It does not expose tool execution or a public CLI connection command.

## Destination and trust

The adapter matches the exact endpoint and authentication binding from the approved proposal.
Normal connections use system TLS trust and public network addresses.
The adapter selects an admitted address once and pins it for the session.
It refuses redirects and does not use proxy environment variables.

The local proof uses an explicit loopback endpoint and a temporary certificate authority.
That trust applies only to the exact test endpoint. It does not change system trust.
Private company networks require a separately reviewed destination policy before support claims.

## Credentials

The trusted host resolves the credential reference before each POST.
The result names the exact binding, issuer, audience, and scopes, with an expiry and revocation status.
The adapter refuses mismatched, expired, or revoked metadata before the next request.
It treats the token as opaque and sends it only to the pinned endpoint.

Credential values do not enter discovery results or durable authority records.
Errors contain fixed codes instead of tokens or provider messages.
The host must supply trustworthy metadata and current revocation evidence.
This adapter does not implement OAuth enrollment, refresh, or token introspection.

## Supported exchange

Each protocol message uses a separate POST.
The adapter accepts bounded JSON responses and finite server-sent events, or SSE.
It checks request identity, protocol order, and the session identifier.
Unexpected server requests or notifications stop discovery. They never invoke a local tool.

Response size, request count, and elapsed time have fixed limits.
Malformed responses, changed catalogs, expired credentials, and interrupted sessions leave the durable operation held.
The controller does not retry the operation automatically.

The adapter does not open background GET streams or resume interrupted streams.
It does not restart an expired remote session or send DELETE requests.
Closing the adapter destroys local requests and sockets. It does not prove remote session termination.

The [MCP transport specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports) defines the broader transport.
This adapter supports a bounded discovery subset. It does not establish full transport compatibility.

## Evidence and limits

Synthetic tests combine the real HTTPS adapter with the PostgreSQL authority store.
The server receives contact only after the durable intent and exact approval exist.
Tests cover JSON and SSE discovery, credential refusal, catalog changes, and redirect refusal.
The redirect destination receives no request.

No external endpoint, customer record, or real employee account is part of this proof.
Both harness boundaries, production stdio containment, and denial of alternate native routes remain open.
Only Hanna merges main or approves a public release.
