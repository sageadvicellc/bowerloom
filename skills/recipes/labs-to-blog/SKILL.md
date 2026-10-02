---
name: labs-to-blog
description: Turn a completed, committed Labs experiment into an evidence-linked Markdown draft and one reviewed draft pull request through an already provisioned Trellis recipe controller.
---

# Labs experiment to draft PR

Use this skill when the operator asks for an experiment blog draft. Read `docs/recipes/labs-to-blog.md` from the installed Trellis source. Keep private business configuration outside Trellis.

1. Inspect the installed recipe. It supplies the trusted repository, source prefix, draft path, source revision, and connection. Do not propose a new credential path or endpoint through tool input. If setup is needed, repeat `setup` with the same sealed installation; a changed scope requires operator review.
2. Read one completed experiment and its supporting files at an exact GitHub commit. Preserve their UTF-8 content and SHA-256 digests. Make unknown conclusions and limitations explicit. A title or status label alone is not evidence of success.
3. As the personal agent, draft the prose using the operator's existing harness. Include exact commit-addressed evidence links. Supply explicit claim text and supporting evidence IDs. This recipe does not invoke a model API for you.
4. Critique the draft: check whether each claim follows from the cited evidence, qualify uncertainty, and remove unsupported claims. Citation presence alone is not verification. Record actual corrections and effort; unknown usage, human review time, and baseline duration remain null. Never invent a matched benchmark or improvement percentage.
5. Call `plan` with `{experiment,draft,metrics}`. Show the exact draft, destination, and returned digest. `run` without approval pauses durably for review. Use `review` or `status` to inspect it.
6. The operator separately invokes the approval CLI with the exact job and plan digest. MCP intentionally exposes no approval tool. Do not impersonate the configured issuer, obtain its capability from another file, or bypass this boundary.
7. After that approval is recorded, `run` creates or updates the single draft branch/PR. Report its URL and draft status. Merge and publication are separate decisions; this recipe performs neither.
8. On `NEEDS_RECONCILIATION`, use `reconcile` for scoped reads. Never delete the record, change experiment IDs to evade a consumed claim, or retry a write through another tool. An unresolved result goes to the operator. `cancel` blocks future steps but may leave an already transmitted effect to reconcile.

Roles: the personal agent drafts; the claim reviewer evaluates evidence; the installed controller verifies bindings and handles connections; the operator issues exact approval. These are responsibilities, not additional autonomous model processes. No role may rewrite the controller's permissions.

Optional recurring triggers belong in a separately installed n8n workflow or scheduler. They can submit the same identifiers and inspect progress; they do not gain the writer's approval authority.
