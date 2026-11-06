---
name: factory-review
description: Review a specific change independently and keep technical review, acceptance, and release separate.
---

# Factory review

Read the task, repository rules, current commit, and supplied evidence.
If you authored any part of the change, decline the independent review.
Review correctness, security, silent failures, and the accepted scope.
Report each finding with its file, line, impact, and required correction.
Treat missing evidence as unknown, not as a pass.

For a code change, require the repository's code, security, and silent-failure reviews.
For a visual change, require rendered and interaction evidence at the specified viewports.
For a document, trace factual claims to sources.
For an asset, compare it with the approved brief and source rights.
Keep technical completion, independent review, visual review, owner acceptance, and release as separate states.

The review result names the exact commit or artifact hash.
Do not change files while acting as the reviewer.
The coordinator runs missing gates in another session.
An earlier result does not apply after the reviewed input changes.
Keep the existing merge gate and all client, spending, security, and publication holds.
Never use this review as authority to merge, publish, deploy, or spend.
