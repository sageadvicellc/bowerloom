# Inside `.bowerloom`

At `d2e5847b3c78e728a441cf2c2777fd6652c26a2c`, startup proposes 20 portable files. Approved installation adds one private receipt.
This example produced a plan. It created no project and started no team.

```text
<project>/
└── .bowerloom/
    ├── START-HERE.md
    ├── brief.json
    ├── installation-receipt.json  [PRIVATE; approved apply only]
    ├── manifest.json
    ├── milestones.md
    ├── optional-controls.md
    ├── skills/
    │   └── personal-assistant/
    │       ├── SKILL.md
    │       └── profile.json
    ├── startup-review.md
    ├── startup.json
    ├── teams/
    │   └── first-team/
    │       ├── assets/
    │       │   ├── brief.json
    │       │   ├── milestones.md
    │       │   └── working-agreement.md
    │       ├── maps/
    │       │   ├── relay.json
    │       │   └── vines.json
    │       ├── prompts/
    │       │   ├── lead.md
    │       │   ├── maker.md
    │       │   └── reviewer.md
    │       ├── skills/
    │       │   └── bounded-draft.md
    │       └── team.yaml
    └── working-agreement.md
```

The receipt contains machine-specific identities. Exclude it from sharing.
Review brief and goal text for private information before sharing portable files.

The manifest selects the assistant and team. It does not select every root document.
Relay and Vines maps declare behavior. They are not running services.
The proposed files `output/scope.md`, `output/draft.md`, and `output/review.md` do not exist in this example.

## Separate operations

Optional installations use separately selected paths and approvals. They are not additional startup directories.
These include harness state, MCP inputs, local connections, backend files, and execution credentials.
Startup history lives beside `.bowerloom/`. The default local registry lives at `~/.local/state/bowerloom/registry.json`.

## Planned routines

At this source revision, `.bowerloom/routines/` is planned work under issue #66.
It does not belong in the generated startup tree.

## Sources

[Startup files](https://github.com/sageadvicellc/bowerloom/blob/d2e5847b3c78e728a441cf2c2777fd6652c26a2c/packages/startup/src/scaffold.ts#L18).
[Private receipt](https://github.com/sageadvicellc/bowerloom/blob/d2e5847b3c78e728a441cf2c2777fd6652c26a2c/packages/startup/src/index.ts#L137).
[Engineering hierarchy](sources/hierarchy.json).
