# Connections between local teams

A connection lets one installed team read one approved definition from another local root.
It does not merge their directories or grant access to other files.
The connection receipt stays outside both project roots because it contains machine paths and private approval evidence.
Keep portable `.bowerloom` definitions in version control. Keep connection receipts private.

## Prepare and approve

First install both roots with `bowerloom init` and inspect them with `init status`.
Create a private directory for connection receipts with permissions `0700`.
From the built Bowerloom checkout, run:

```sh
node dist/apps/cli/src/main.js link plan --from /absolute/personal-root --to /absolute/project-root --file working-agreement.md --out /absolute/private-links/agreement.json
```

Read the shared contents and the receiving path before approval.
The command prints a revision that identifies this exact plan.
Use the same inputs with `link apply --approve REVISION` after approval.
Add `--json` to `link plan` for the full machine-readable record.

## Read and revoke

The personal agent reads the approved definition for its receiving team:

```sh
node dist/apps/cli/src/main.js link read --connection /absolute/private-links/agreement.json --target /absolute/project-root
node dist/apps/cli/src/main.js link revoke --connection /absolute/private-links/agreement.json
```

Revocation appends a marker and preserves the receipt. Repeated revocation is safe.
Changed definitions or directory identities stop reads. Create a new plan and receipt after a change.

## Boundaries

The alpha permits the brief, setup review, working agreement, milestones, and first-team YAML.
The review exposes the exact shared contents before approval. A brief can contain sensitive project information.
A connection grants no source writes, execution, emergency-stop authority, or access through other connections.
It starts no server, sync process, model, or remote request.

These controls govern Bowerloom commands. They do not restrict an unrelated process with the same operating-system account.
The alpha requires trusted, user-owned directories. It rejects symbolic links and unsafe file bindings.

Each export permits up to 512 KiB. Private receipts permit up to 4 MiB after JSON escaping.
The command rejects terminal controls and invisible formatting controls in shared text. Tabs and line endings remain permitted.
