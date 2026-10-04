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
