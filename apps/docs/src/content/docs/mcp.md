---
title: "MCP connections"
description: "Portable declarations are separate from installed endpoints and discovery authority."
---

<!-- release:status:start -->
**Open beta · unreleased** · `0.7.0-beta.0`

**Unavailable until publication.** The npm package is not published. Run the installation command only after this exact version is published.

Setup does not start workers, grant runtime access, or authorize connected actions.

- Full runtime acceptance remains incomplete.
- The initial beta needs founder acceptance and publication approval.
- Unattended support requires an independently accepted installed security configuration.
<!-- release:status:end -->

MCP connects applications to tool servers. In this beta work, a portable declaration describes the connection while private local bindings select endpoints and secret references.

## CLI reference: planning only

The exposed CLI path accepts caller-selected synthetic declaration, binding, and recorded catalog files:

Use separately reviewed synthetic input files with the installed executable.

```sh
bowerloom mcp plan --declaration /absolute/synthetic/declaration.json --binding /absolute/private/binding.json --catalog /absolute/synthetic/catalog.json --synthetic
```

This is a reference shape, not a ready-made fixture bundle. Use only separately reviewed files. The result is private planning output. It starts no server and invokes no tool.

Recorded catalog data is not authenticated live discovery. Server annotations and descriptions never determine permission classes.

## Internal engineering evidence

Internal discovery adapters cover bounded HTTPS, trusted local stdio, and a separately approved synthetic container path. Their tests do not expose a public connect or tool-call command.

Container controls, independent guardian cleanup, checkpoints, and receipts narrow specific failure paths. They do not prove arbitrary server safety or universal native tool containment.

## Support boundary

[Current support](/docs/status/) records the tested systems and release limits. This page does not establish full runtime acceptance.
