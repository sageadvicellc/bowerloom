# Alpha verification

From the repository root, run `node tools/verify.mjs` after dependency installation.

The runner performs TypeScript checks, offline regressions, the landing build, and a production dependency audit. It writes bounded logs under `.trellis/verification`.

Each command stops after fifteen minutes or two MiB of output. The runner stops at the first failed command.

The audit fails on high or critical advisories. An unreadable audit result also fails. Review failures before changing dependencies or exceptions.

This audit detects known dependency advisories. It does not replace source review or prove freedom from vulnerabilities.

Tests that require private services remain separate. The report does not claim that skipped service tests passed.

## Hosted workflow

`trellis-alpha.yml` is a prepared workflow, not an active GitHub workflow. The current coordinator App lacks the `workflows` permission.

The campaign does not expand that permission. An authorized maintainer can install this file under `.github/workflows` after review.

The workflow uses pinned actions and a read-only token. It creates no deployment, comment, approval, merge, or new secret.

GitHub execution remains untested until the workflow is installed and runs. Local verification remains available without that grant.
