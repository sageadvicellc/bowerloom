# Portable Bowerloom parts

This alpha package validates and installs selected local parts for Codex. A part is either a skill or an inert team definition.

The bundle directory contains `.bowerloom/manifest.json` and explicitly listed files. The installer reads no unlisted assets and downloads nothing.

## API

All three functions are synchronous. The package uses Node built-ins without new dependencies.

```ts
validateBundle(bundleDir: string): BundleValidation
planInstallation(input: InstallationInput): InstallationPlan
installBundle(input: InstallationInput, approvalRevision: string): InstallationReceipt
```

```ts
interface InstallationInput {
  bundleDir: string;
  selected: string[];
  harness: string;
  targetDir: string;
}
```

`bundleDir` names the directory that contains `.bowerloom/`. `targetDir` must be an absolute path to a new workspace directory.

Only `codex` is supported. The target parent must exist, belong to the current user, and deny group or other writes.

The returned plan includes selected parts and their dependency closure. It binds the target, source hashes, manifest hash, schema version, and adapter version.

The SHA256 `revision` identifies the canonical plan. Installation requires that exact revision. Changed source content, selection, or target invalidates the earlier approval.

## Manifest

```json
{
  "schemaVersion": "bowerloom/v1alpha1",
  "parts": [
    {
      "id": "report",
      "kind": "skill",
      "files": ["skills/report/SKILL.md", "skills/report/sample.csv"],
      "dependsOn": [],
      "requiredControls": ["installer-local-files-only", "installer-explicit-review"]
    },
    {
      "id": "editorial",
      "kind": "team",
      "files": ["teams/editorial/team.json"],
      "dependsOn": ["report"]
    }
  ]
}
```

The schema rejects unknown fields and unknown required controls. Dependencies must exist. Cycles are not supported.

A skill requires `skills/<id>/SKILL.md`. Its other files must use that same directory prefix. Team files use `teams/<id>/`.

All paths are relative to `.bowerloom/`. Hidden segments, traversal, backslashes, scripts, hook directories, and common secret filenames are forbidden.

Files must use the `.md`, `.txt`, `.json`, `.yaml`, `.yml`, or `.csv` extension. Files must contain valid UTF-8 without null bytes or private-key markers.

The package rejects symlinks, hard links, and executable file modes. It preserves accepted UTF-8 bytes, including line endings and a byte-order mark.

The manifest permits up to 32 parts and 128 listed files. Each file is at most 64 KiB. Total source size is at most 2 MiB.

## Projections

A projection is a file copied into an adapter-specific location. A skill projects into `.agents/skills/bowerloom-<id>/` with its relative files intact.

Team definitions project into `.bowerloom/teams/<id>/`. They remain data. This adapter does not interpret their contents or execute a team.

`START-HERE.md` explains the installed parts and limits. `.bowerloom/installation-receipt.json` records origin hashes, destination paths, and the exact approved plan.

The receipt lists hashes for the copied files and `START-HERE.md`. It does not list a hash of itself.

The bundle path is not part of the revision. Copying a bundle to another local directory preserves its revision and projections.

The target path is part of the plan. Moving the destination requires a new plan and approval.

## Installation boundary

Installation approval authorizes only the listed local file creation. It does not authorize skill execution, start workers, elevate permissions, or grant network access.

The only accepted controls are `installer-local-files-only` and `installer-explicit-review`. They apply to the installer, not future agent actions.

The plan and receipt always report `executionAuthorized: false`. Other tools must enforce the personal agent's permissions when the user invokes a skill.

Skill instructions are executable guidance for an agent after discovery. Review their text before use. Filename filters cannot establish that arbitrary prose contains no secrets or unsafe instructions.

The installer does not prove that a team or skill works across harnesses. Codex discovery behavior and later execution require separate acceptance evidence.

## Writes and concurrency

The installer creates a cooperative sibling lock with exclusive creation. It writes a new staging directory and reads the bundle again before the final rename.

A changed source fails installation. Any failure before the rename removes only this attempt's staging directory and lock.

The installer rejects every observed existing target, including empty directories. Node does not provide a portable atomic no-replace directory rename.

A hostile process under the same user can race the final collision observation and rename. The cooperative lock does not defend against that process.

Use a trusted parent directory without concurrent writers. Symlink observations also require that assumption. This alpha does not claim a hostile-filesystem security boundary.

A crash can leave a staging directory or lock. Inspect those paths before manual removal. The installer never removes an earlier lock or unrelated staging directory.

## Example

The synthetic bundle is at `examples/portable/report-seed`. Select `report` for the skill alone or `editorial` to include its skill dependency.

From the repository root, compile and run the package tests:

```sh
npm run build
node --test packages/portable/test/portable.test.mjs
```

The tests cover dependency selection, source hashes, stale approvals, path attacks, symlinks, rollback, destination collisions, and inert team projections.
