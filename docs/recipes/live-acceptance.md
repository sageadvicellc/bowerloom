# Recorded GitHub recipe trial

The prepared recipe passed its bounded live trial on October 2, 2026. Founder acceptance remains pending.

The implementation revision was `d8d7444e567ba8d5611680e6ffeaf6d284690bd4`.

The trial created [draft pull request #41](https://github.com/sageadvicellc/trellis/pull/41) against `feature/trellis-v1`. Its recorded head was `a7dac0342a43663682f8d3269fddcfe408800b0a`.

That pull request contained one changed file, `drafts/labs/alpha-authoring.md`. Main remained at `e86189ad7fe3660fda1f0b4a098df91ed2e84502` during the trial.

## Observed behavior

The actual compiled CLI accepted the prepared recipe input. Repeated setup and planning returned the same identities.

The first unapproved run returned `WAITING_APPROVAL`. It made no GitHub write. The operator then inspected and approved the exact plan.

The approved run created the draft pull request. The test harness deliberately dropped GitHub's successful response.

Trellis returned `GITHUB_WRITE_UNKNOWN` and held the job at `NEEDS_RECONCILIATION`. It did not retry the uncertain write.

A fresh process used read-only reconciliation. Reconciliation inspected the remote result and moved the job to `DRAFT_PR_READY`.

Two later run calls returned the same pull request without additional HTTP requests. The CLI review command reopened the saved result.

The saved result includes the plan digest, source references, approval record, GitHub receipt, and operation states.

## Evidence boundaries

The trial used real PostgreSQL and a repository-scoped GitHub App credential. Private credentials and installation files remain outside this repository.

The selected experiment record was sanitized. The personal agent supplied the blog prose. This trial did not execute a newly authored agent crew.

The lead retained private command outputs and HTTP method records. Independent review found no actionable mismatch between those records and the founder guide.

The same-OS operator remains trusted. This trial does not prove human identity, arbitrary scenario support, or a measured productivity improvement.

The adapter requires an exclusive branch namespace. A concurrent external writer can change a branch after its last inspection.

The public installer and release remain unpublished. The landing-page redesign has separate acceptance work. Main merge and publication remain founder decisions.

## Supporting verification

The earlier assembled candidate recorded 473 passing tests, 10 opt-in skips, and no failures. Seven separate real PostgreSQL scenarios passed.

The CLI repair added five subprocess cases. Those five cases and the existing MCP integration case passed against the repaired implementation.

These results cover their recorded revisions. They do not imply that every later source change received the same full test run.

Read [the recipe guide](labs-to-blog.md) for prerequisites and commands. Read [implementation evidence](implementation-evidence.md) for the earlier author and repair records.
