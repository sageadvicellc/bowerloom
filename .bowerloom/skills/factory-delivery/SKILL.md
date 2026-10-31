---
name: factory-delivery
description: Complete one authorized repository change through its existing engineering or asset workflow.
---

# Factory delivery

Accept one task from the intake owner.
Read the repository's current instructions, accepted task, and exact input revision.
If another session owns the task, stop and return it to the intake owner.
Use an isolated branch from the repository's updated default branch.
Preserve unrelated files and active worktrees.

For code, use the repository's ECC workflow and required tests.
For design or assets, use the approved brief and that repository's design and asset skills.
Run the repository's required gates before every commit.
Never disable hooks or substitute a passing test for visual acceptance.
Keep client evidence inside the client repository's approved boundary.

Record the changed paths, commit, gate results, acceptance evidence, and unresolved findings.
Request independent review from a session that did not author the change.
Bind every review to the current commit.
If the commit changes, obtain a new review of the changed scope.
Do not approve or merge your own work.
Use the existing draft pull request and merge path.

After an interruption, reread the task and completed effects before repeating an action.
Follow the repository's retry limit.
If no retry limit exists, return the failed attempt and ask the coordinator to set the next attempt.
Do not start an unbounded loop.
Return blocked when access, a decision, or an acceptance prerequisite is absent.
