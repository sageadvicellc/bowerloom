---
title: "MCP connections"
description: "Inspect the planning-only interface without connecting a tool server."
section: "Guides: Connections and shared work"
order: 13
---

MCP connects applications to tool servers. A portable declaration describes a proposed connection. A private binding selects local endpoints and secret references.

<!-- release:status:start -->
**Open beta · unreleased** · `0.7.0-beta.0`

**Unavailable until publication.** The npm package is not published. Run the installation command only after this exact version is published.

Setup does not start workers, grant runtime access, or authorize connected actions.

- Full runtime acceptance remains incomplete.
- The initial beta needs founder acceptance and publication approval.
- Unattended support requires an independently accepted installed security configuration.
<!-- release:status:end -->

## Ask your agent

```text
Explain the current Bowerloom MCP planning path and its required synthetic files. Do not connect a server, resolve secrets, or invoke tools.
```

## Agent procedure

### Prerequisites

For CLI operations, first meet the exact publication and installation requirements in [Install Bowerloom](/docs/start/).

The package is unpublished. Public readers must stop before these commands. The examples describe the reviewed candidate.

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

If the input scope or private binding is unclear, stop. Internal adapter tests do not supply a public connect command.

## Internal engineering evidence

Internal discovery adapters cover bounded HTTPS, trusted local stdio, and a separately approved synthetic container path.

Their tests do not establish arbitrary server safety or universal native tool containment. They expose no public connection tutorial here.

## Support boundary

[Current support](/docs/status/#connections) records the connection limit. [Security](/docs/security/) explains untrusted tool descriptions.
