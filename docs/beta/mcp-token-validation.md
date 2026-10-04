# MCP token validation

This internal resource-side API validates a narrow profile of signed access tokens against a trusted local policy.
A JWT is a signed record of token claims. This profile accepts only `RS256` tokens with the `at+jwt` type.
The caller supplies synthetic evidence. No public connection command or company service uses this API in this slice.

## Required evidence

- An HTTP binding names the issuer, audience, allowed scopes, and credential reference.
- A trusted policy pins that binding, the expected subject and client, public signing keys, time limits, and an exact revocation snapshot.
- A revocation snapshot lists revoked token identifiers, subjects, and keys for the bound subject and issuer.
- A trusted clock supplies the current time. The caller supplies the token separately from the binding and policy.

The validator uses `jose` version `6.2.12` for signature and claim validation.
It rejects other algorithms, remote key references, private keys, duplicate JSON fields, and unsupported token structures.
It requires the exact issuer, one exact audience, expected subject and client, and declared scope set.
Expiry, issue time, start time, maximum age, and maximum lifetime must satisfy the trusted policy.

The policy pins a fresh revocation snapshot by revision and epoch. An epoch is a monotonically increasing policy version.
If revocations change, the trusted host must update the snapshot and its policy before the next validation.
An older snapshot cannot match the updated policy.
This pure API stores no durable version floor. The trusted host must prevent rollback of both the policy and snapshot together.

## Result and boundaries

A successful result contains private validation evidence. It contains no bearer token, raw signing key, or token identifier.
It grants no tool access or execution authority. A valid signature does not approve a tool effect.
Failures use fixed diagnostics. They do not echo tokens, claims, or library error payloads.

The validator reads no files, contacts no endpoint, and starts no process.
It does not discover an issuer, fetch signing keys, resolve a credential reference, refresh tokens, or perform OAuth registration.
This resource-side profile does not accept opaque tokens. It does not establish general provider compatibility.
Outbound OAuth clients must treat access tokens as opaque. This validator is not an outbound client inspection requirement.
The host remains responsible for trusted policy provisioning, clock integrity, durable revocation state, and transport enforcement.

## Synthetic resource test

A temporary HTTPS server on `127.0.0.1` validates a token before it returns a synthetic catalog.
The test generates local RSA signing keys and a temporary TLS certificate. It changes no system trust store.
A valid token reaches the catalog handler. Wrong issuer, audience, subject, client, scope, and expiry stop before that handler.
A newly revoked token and an older snapshot also fail. The response contains only a fixed unauthorized message.

Use the reviewed macOS checkout with Node `>=24.11.0 <25`, installed dependencies, and OpenSSL on `PATH`.
Run these commands from the repository root:

```sh
npm run build
node --test packages/mcp-connections/test/auth.test.mjs \
  packages/mcp-connections/test/auth-tls.test.mjs
```

The tests use synthetic identities and tokens. They contact no external issuer or MCP server.
The CLI artifact excludes the fixture server, private test keys, and test source.

The [MCP authorization specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization) defines audience binding and token handling requirements.
The [jose verifier documentation](https://github.com/panva/jose/blob/main/docs/jwt/verify/functions/jwtVerify.md) describes signature and claims validation.
These sources were read on October 4, 2026. This slice does not establish a complete OAuth flow.

[RFC 9068](https://www.rfc-editor.org/rfc/rfc9068.html) requires the client identifier claim and distinguishes resource validation from opaque client handling.
