# Optional connections and stopping work

You can finish setup review without a connection, backend, or running team. Ask your personal agent to explain these controls only when you need them. None runs during setup.

## Connect two existing local setups

A connection lets one local team read one explicitly selected definition from another installed root. It does not merge projects, grant writes or execution, or provide access to other files. It starts no server or synchronization service.

Ask your agent to check both installations with `init status --target`, select the exact source file with you, and prepare a `link plan`. The plan shows the shared contents, receiving root, and exact approval revision. A brief may contain private information. Approve only the content you intend to share.

The following examples use the installed `bowerloom` command. Ask your agent to verify the commands against your installed version before use. Paths and REVISION are placeholders for your agent to replace, not commands to run unchanged. The private receipt directory must already exist with owner-only access (0700); keep it outside both project roots. The receipt file must be new.

```sh
bowerloom init status --target /absolute/source-root
bowerloom init status --target /absolute/receiving-root
bowerloom link plan --from /absolute/source-root --to /absolute/receiving-root --file working-agreement.md --out /absolute/private-links/agreement.json
```

Only after you approve that exact plan may your agent apply the same inputs:

```sh
bowerloom link apply --from /absolute/source-root --to /absolute/receiving-root --file working-agreement.md --out /absolute/private-links/agreement.json --approve REVISION
bowerloom link read --connection /absolute/private-links/agreement.json --target /absolute/receiving-root
```

## Revoke the connection

Tell your agent to revoke the selected connection:

```sh
bowerloom link revoke --connection /absolute/private-links/agreement.json
```

Revocation prevents future reads through this connection and preserves its receipt. Repeating it is safe. It does not erase copies already read, stop a team, or limit unrelated programs using your operating-system account. Changed source contents or root identities also block reads; a new connection needs a new plan and approval.

## Stop registered local work

This setup enrolls no work and starts no workers. Before a later supported execution, your agent must obtain separate approval to register its team and private installation. A connection grants no stop authority.

For a separately registered first team, ask your agent to stop its work:

```sh
bowerloom destruct first-team --root /absolute/project-root
```

To request a stop for every team in the same local registry:

```sh
bowerloom destruct all
```

The default registry is `~/.local/state/bowerloom`. If registration used a different registry, append `--registry /absolute/private-registry` to the stop command. `all` means that one registry, not every machine, user, or process. It cannot stop an unrelated personal-agent session or unregistered work. No handoff is required.

`destruct` requests a stop for registered Bowerloom work. It preserves project files, definitions, outputs, saved history, and backend services. It does not delete your setup or undo accepted external actions.

Read the reported result:

- `STOPPED`: The registered owner reported completed cleanup.
- `NOT_RUNNING`: No execution began, or earlier executions finished.
- `STOP_UNCONFIRMED`: Cleanup remains uncertain.

Repeating the command observes the existing request. Do not treat a timeout as success. Do not restart work while its stop remains unresolved. A stopped team needs a separately approved new registration before work resumes.
