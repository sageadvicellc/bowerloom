# Trellis MCP

The local MCP server exposes the recipe controller through standard input and output. It uses the same validation and runtime as the CLI.

The operator selects one private installation when the server starts. Tool arguments cannot select another installation or supply an approval issuer.

## Start

After building the monorepo on Node 24, configure your agent's MCP client with this command:

```text
node /absolute/trellis/dist/apps/mcp/src/main.js --installation /absolute/private-installation.json
```

Use an installation prepared through the [recipe instructions](../../docs/recipes/README.md).

The server exposes inspect, setup, plan, review, status, run, reconcile, and cancel. It does not expose approval.

The operator reviews the plan and records exact approval through the CLI. Until then, a run stops at its saved review pause.

## Trust boundary

Keep the private installation and its credentials outside versioned recipe files. Configure access for the intended operator only.

MCP descriptions and annotations explain behavior. They do not enforce permissions. The shared controller enforces destination, approval, and effect rules.

An agent with the operator's full filesystem and terminal authority can act as that operator. This server does not create a separate human identity.

The alpha serves one local installation per process. It provides no HTTP endpoint or multi-user authentication service.

The transport tests use the official SDK client. They cover tool dispatch, unavailable approval, error redaction, and input bounds.
