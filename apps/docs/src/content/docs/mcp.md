---
title: "MCP connections"
description: "Inspect the planning-only interface without connecting a tool server."
section: "Guides: Connections and shared work"
order: 13
---

MCP connects applications to tool servers. A portable declaration describes a proposed connection. A private binding selects local endpoints and secret references.

<!-- release:status:start -->
Open beta · 0.7.0-beta.2

Setup does not start workers, grant runtime access, or authorize connected actions.
<!-- release:status:end -->

## Ask your agent

```text
Explain the current Bowerloom MCP planning path and its required synthetic files. Do not connect a server, resolve secrets, or invoke tools.
```

## Agent procedure

### Prerequisites

Install the matching CLI version through [Install Bowerloom](/docs/start/).

Use three separately reviewed synthetic files: a declaration, private binding, and recorded catalog. Keep local binding and output private.

### CLI reference: planning only

This command shows the exposed shape. It is not a supplied fixture bundle.

```sh
bowerloom mcp plan --declaration /absolute/synthetic/declaration.json --binding /absolute/private/binding.json --catalog /absolute/synthetic/catalog.json --synthetic
```

Replace each path with its separately reviewed synthetic file. The command reads those files and returns private planning output.

It does not discover live tools, resolve secrets, start a server, connect, or invoke a tool.

### Treat catalog content as untrusted

Recorded catalog data is not authenticated live discovery. Server annotations and descriptions cannot determine permission classes.

If the input scope or private binding is unclear, stop. The CLI has no public connect command.

<a id="internal-engineering-evidence"></a>

## Connection scope

This guide covers planning from selected files. It does not provide server connection, credential resolution, or live tool discovery.

A catalog description cannot establish a server's safety or expand your agent's permissions.

## Support boundary

[Current support](/docs/status/#connections) records the connection limit. [Security](/docs/security/) explains untrusted tool descriptions.
