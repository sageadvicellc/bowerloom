---
name: factory-handoff
description: Pass a bounded request or accepted result between factory arms without widening authority.
---

# Factory handoff

A handoff transfers a request and evidence, not repository access or approval.
Record the task id, source repository, destination arm, owner, purpose, input revision, approved data boundary, and expected result.
Include the source links, acceptance criteria, decisions, and stop condition.
Exclude secrets, raw client material, and private account data.
If the destination has no accepted owner, retain the task as waiting.

Use these task states: proposed, ready, working, review, waiting, blocked, accepted, and released.
Record each completed effect with its input revision and resulting artifact or URL.
Before retrying, make sure that the same effect did not already complete.
After an interruption, reread this record and the live task.
Never reconstruct an uncertain completed effect from memory.

Research requests ask one answerable question or propose one bounded test.
Article candidates use accepted public evidence and name either the Bowerloom or Sage Advice desk.
Client material requires Hanna's approval and the client's approval before either shared arm receives it.
Evidence stays in its source repository until its owner approves another use.
Article candidates require public clearance before editorial use.

For release health, report the current checks, deployed revision if known, incidents, and approval state.
Do not deploy or publish from a release-health pass.
Keep runs private outside version control unless the record contains only approved public evidence.
No schedule or automatic transport is installed by this skill.
