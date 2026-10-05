---
title: "MCP connections"
description: "Portable declarations are separate from installed endpoints and discovery authority."
---
MCP connects applications to tool servers. In this beta work, a portable declaration describes the connection while private local bindings select endpoints and secret references.

## Public command: planning only

The exposed CLI path accepts caller-selected synthetic declaration, binding, and recorded catalog files:

Run the command from the pinned checkout prepared in [Start here](/docs/start/).
For a private artifact, use the executable procedure supplied with its review packet.

```sh
node dist/apps/cli/src/main.js mcp plan --declaration /absolute/synthetic/declaration.json --binding /absolute/private/binding.json --catalog /absolute/synthetic/catalog.json --synthetic
```

This is a reference shape, not a ready-made fixture bundle. Use only separately reviewed files. The result is private planning output. It starts no server and invokes no tool.

Recorded catalog data is not authenticated live discovery. Server annotations and descriptions never determine permission classes.

## Internal engineering evidence

Internal discovery adapters cover bounded HTTPS, trusted local stdio, and a separately approved synthetic container path. Their tests do not expose a public connect or tool-call command.

Container controls, independent guardian cleanup, checkpoints, and receipts narrow specific failure paths. They do not prove arbitrary server safety or universal native tool containment.

## Evidence and limits

Source reference: [`packages/mcp-connections`](https://github.com/sageadvicellc/bowerloom/tree/37f1efab545921d08378956eef854c3b17bd4f16/packages/mcp-connections), development snapshot `37f1efa`. Internal proofs use synthetic endpoints and controlled services. Full OAuth enrollment, arbitrary endpoint compatibility, and complete production containment are not claimed here.
