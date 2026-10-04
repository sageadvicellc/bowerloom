# Bounded MCP discovery

This internal API compares a server catalog with a reviewed synthetic plan. It does not expose a public connection command.
The `mcp plan` command remains read-only. It reads recorded files and starts no server.

A trusted adapter supplies protocol messages for this API. The adapter is reviewed application code, not an agent-selected function.
Before the adapter opens, the caller supplies the exact revision from `planMcpConnection`.
A wrong revision stops discovery before the adapter runs.
This approval covers one discovery session. It grants no tool invocation or other execution authority.

## Session behavior

The engine initializes the protocol with empty client capabilities. It requires the expected protocol, server name, version, and tools capability.
It sends the initialization notification, then requests every tools page within fixed limits.
It rejects changed catalogs, duplicate tools, cursor cycles, unexpected notifications, timeouts, and interrupted sessions.
Server text cannot grant permissions or request model work through this interface.

The result states `trusted-adapter-session`. It records the matching plan and catalog revisions, page count, and tool count.
It does not establish authenticated identity, OAuth validation, runtime portability, or a sandbox boundary.
Successful discovery requires the adapter to complete cleanup. Failure to complete cleanup cannot produce a success result.
A late adapter response cannot reverse a timeout or cancellation.

## Test transport evidence

The stdio test starts a fixed synthetic server through the installed Node executable. The server uses MCP SDK `1.31.0`.
The child receives an empty environment. It advertises two synthetic tools through two pages and has no tool invocation handler.
The test closes the child after discovery. This test does not launch an arbitrary configured executable.

The HTTP test starts a temporary HTTPS server on `127.0.0.1`. A temporary certificate supplies local TLS trust for that test only.
The adapter sends JSON requests and accepts JSON responses. It includes the negotiated protocol header after initialization.
The test proves a matching catalog, schema drift refusal, and redirect refusal. It sends no authorization header.
This fixture does not prove OAuth, SSE response handling, remote network safety, or interoperability with an external HTTP server.

The adapters live in the test directory. The CLI artifact excludes them and the synthetic server.
The internal engine ships through the existing package export. No public CLI verb can start discovery in this slice.

## Reproduce the tests

Use the reviewed macOS checkout with Node `>=24.11.0 <25`, installed dependencies, and OpenSSL available on `PATH`.
Run these commands from the repository root:

```sh
npm run build
node --test packages/mcp-connections/test/discovery.test.mjs \
  packages/mcp-connections/test/live-discovery.test.mjs
```

The test creates certificate files in a temporary private directory. It removes that directory after the test.
The test does not modify system certificate trust or contact an external endpoint.

## Remaining boundary

Production adapters must bind process and endpoint identity to exact approved effects. A trusted callback alone does not enforce that boundary.
The remaining work includes credential resolution, audience and issuer validation, revocation, SSE handling, and interrupted-call reconciliation.
Native alternative routes must fail before the team claims controlled tool execution through either harness.
A matching catalog does not approve any tool effect.

The [MCP lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle) defines initialization, version negotiation, deadlines, and shutdown.
The [tools specification](https://modelcontextprotocol.io/specification/2025-11-25/server/tools) defines paginated discovery.
These sources were read on October 4, 2026. The test results apply only to the reviewed adapters and fixtures.
