# MCP connection plans

MCP connects an agent to tools that a server supplies. This beta slice prepares a private plan from three selected synthetic JSON files.
The command does not contact a server, start a process, read credentials, change a harness, or grant authority.

## Separate three records

- A declaration names the connection, protocol, transport, selected tools, and permission classes. This record is portable.
- A binding names the installed endpoint, server identity, and credential references. Keep this record private.
- A recorded catalog contains caller-supplied tool schemas and server identity. It is test input, not authenticated discovery.

The schemas use `v1beta1`. They accept protocol `2025-11-25` and describe `stdio` or `streamable-http`.
These values define the plan format. They do not prove compatibility with a live server or harness.

## Try the fixture

Use the reviewed developer checkout on macOS with Node `>=24.11.0 <25` and installed dependencies.
Run these commands from the repository root. The fixture contains no real account or credential.

```sh
npm run build
MCP_TRIAL_DIR=$(mktemp -d)
MCP_TRIAL_DIR=$(cd "$MCP_TRIAL_DIR" && pwd -P)
chmod 700 "$MCP_TRIAL_DIR"
for kind in declaration binding catalog; do
  cp "packages/mcp-connections/test/fixtures/streamable-http-$kind.json" "$MCP_TRIAL_DIR/$kind.json"
  chmod 600 "$MCP_TRIAL_DIR/$kind.json"
done
node dist/apps/cli/src/main.js mcp plan \
  --declaration "$MCP_TRIAL_DIR/declaration.json" \
  --binding "$MCP_TRIAL_DIR/binding.json" \
  --catalog "$MCP_TRIAL_DIR/catalog.json" \
  --synthetic
```

The packaged executable accepts the same arguments after `bowerloom`. The private package excludes test fixtures.
Supply your own synthetic files when you test that executable. No public package installation is part of this example.

Keep the output private. It includes local paths, endpoint details, and credential reference names.
If you save the output, use an owner-only directory and file permissions of `0600`.
Do not use the planner as a secret scrubber. It rejects explicit credential fields but cannot identify every secret inside arbitrary text.

## Inspect the result

The plan contains separate revisions for the declaration, binding, and complete recorded catalog.
It also records the input and output schema revisions for every catalog tool.
The file wrapper records exact source bytes, paths, and file identities.

The plan lists the operator-selected permission class for each selected tool. Server descriptions and annotations cannot select that class.
The plan omits schema bodies, descriptions, and annotations from its output. Their contents still affect the catalog revision.
A changed schema, server identity, binding, credential reference, or permission class changes the plan revision.

The result states `planning-only`. All execution, write, discovery, authentication, and runtime portability claims remain false.
An `external-write` label describes the requested effect. It does not approve that effect.
This command has no `apply`, `connect`, `discover`, or `invoke` operation.

## Input limits

- Each selected file must be canonical, absolute JSON with strict UTF-8 and no duplicate keys. Its maximum size is 256 KiB.
- Binding and catalog files require owner-only permissions and an owner-only containing directory.
- Symlinks, hardlinks, unsafe ownership, writable shared directories, and source changes stop planning.
- Protected credential paths and `nmaahc-sm` paths are excluded.
- Transport fields reject inline tokens, headers, passwords, and URL user information, queries, and fragments.
- Local bindings accept absolute executable and working paths. They do not accept command arguments or environment values in this format.

The schema requires object-shaped tool schemas. It pins those schemas but does not compile or execute a JSON Schema validator.
The HTTP binding records OAuth issuer, audience, scopes, and a credential reference. It does not validate a token or resolve a reference.

## Remaining beta work

Live transport discovery, authentication, revocation, interrupted calls, exact effect approvals, and controlled harness projection remain separate work.
Native alternative routes must fail before the team claims an enforced gateway boundary.
No company account or company service starts from a connection plan.

The MCP [lifecycle specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle) requires live initialization and capability negotiation.
The [tools specification](https://modelcontextprotocol.io/specification/2025-11-25/server/tools) defines tool discovery and treats annotations as untrusted hints.
The [authorization specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization) defines HTTP authorization requirements.
These references were read on October 4, 2026. A synthetic plan is not evidence that those runtime requirements passed.

The separate [bounded discovery API](mcp-discovery.md) compares catalogs through trusted test adapters.
It adds no connection operation to this CLI command. Production transport and authentication gates remain open.
