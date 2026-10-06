---
title: "CLI reference"
description: "Find the supported command family and its authority boundary."
---

:::note[Private beta command scope]
Use the [isolated installed executable](/docs/start/). The private `0.7.0-beta.0` trial covers Engineer-profile setup in new and existing projects and successful revision. Recovery, other profiles, and runtime execution remain outside that trial.
:::

Use `bowerloom --help` to read command syntax. Use `bowerloom --version` to read the package version.

This candidate reports `Bowerloom 0.7.0-beta.0` through `--version`. Its general help retains the legacy `v0.7-alpha` heading. The retained heading remains CLI work under [issue #61](https://github.com/sageadvicellc/bowerloom/issues/61). Command presence does not establish runtime readiness.

| Command family | Purpose | Boundary |
| --- | --- | --- |
| `--help`, `--version`, `init --help` | Discover syntax and truthful package version | Read-only. |
| `init plan`, `init apply`, `init status` | Prepare and inspect a first setup | Apply requires the exact plan revision. |
| `revise plan`, `revise apply`, `revise recover` | Change a setup or recover its transaction | Exact old/new approval and retained history. |
| `control plan`, `control register` | Enroll a selected local owner | Separate approval; starts no work. |
| `destruct` | Request registered-work stop | One selected registry; uncertainty stays explicit. |
| `link plan`, `link apply`, `link read`, `link revoke` | Select local text disclosure | Exact file/recipient binding; no execution grant. |
| `harness …` | Selected synthetic configuration projections | Not live settings conversion or model execution. |
| `mcp plan` | Plan recorded synthetic catalog selection | No connection, server start, or tool call. |
| `backend doctor`, `backend plan`, `backend install`, `backend status` | Inspect or plan local backend setup | Setup is separate from first-team file installation. |

Advanced recipe, portable-bundle, and historical demo commands have additional private installation requirements. Their presence in help does not make them a general startup recipe.

## Flags and refusal

Use absolute paths where requested. `init plan --json` and `revise plan --json` expose the full plan. Do not mix `--brief` with inline brief fields.

Malformed or extra arguments refuse. Never replace an approval revision with a guessed value or infer success from an exit without checking its output.

## Candidate and historical evidence

The private `0.7.0-beta.0` candidate exercised help, version, init help, setup, status, and successful revision. [Candidate identity](/docs/status/#private-beta-candidate). Other command families retain their separate evidence limits.

The following source and broader command trial belong to the earlier alpha artifact:

Syntax is bound to [`apps/cli/src/main.ts`](https://github.com/sageadvicellc/bowerloom/blob/cd62b530644dae0fca1cef9e11e287b24356c250/apps/cli/src/main.ts). The bounded installed trial tested discovery/setup/revision/local links/stop, not every help entry. [Exact trial identity](/docs/status/#reviewed-setup-identity).
