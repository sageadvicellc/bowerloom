# Trellis working order

Hanna reviews and merges completed features into `main`. The team owns implementation, peer review, and merges into feature branches within approved scope.

The founder clarified this rule on October 1, 2026. It supersedes earlier blanket merge restrictions in this campaign. Hanna approved the alpha build on October 1, 2026. The bounded implementation campaign is active.

## Branch ownership

An integration branch combines accepted work from task branches. The current integration branch is `feature/trellis-v1`. The integration lead owns its assembled result and evidence.

Workers create task branches from the integration branch. Each task has an owner, a bounded change, and observable acceptance criteria. Its pull request targets the integration branch.

Only Hanna, through `hannasage`, merges into `main`. Agents never push or merge into `main`. The review identifies the exact feature revision that Hanna will receive.

## Team workflow

1. Assign a task and its acceptance criteria.
2. Create its branch from the current integration branch.
3. Implement the task and run the relevant tests.
4. Request review from another agent.
5. Resolve findings and repeat the affected tests.
6. Record the review against the current commit.
7. Make sure that the merge targets the intended feature branch.
8. Merge accepted work into that branch.
9. Run the relevant integration tests.
10. Update the review packet with results and remaining gaps.

The author cannot supply the independent review. Changed code needs renewed review. The integration lead resolves routine conflicts and obtains review of the resulting changes.

Feature merges do not need Hanna's approval for each task. Escalation is for a scope decision, an unresolved tradeoff, or a blocker that requires Hanna. Routine branch coordination stays with the team.

## Identities and execution

Use coda-crew for coordination and h4n-n4 for worker activity when their permissions support the action. Use sagehanna as the authorized fallback. Never use hannasage for agent activity.

The lead can merge reviewed task commits locally and push the integration branch through scoped App credentials. Each push names the exact feature destination. The old team's merge automation stays disabled.

A successful branch push does not establish server-enforced merge protection. This working order records authorized behavior. Review evidence and repository protection remain separate concerns.

## Founder review

The daily packet presents the assembled feature, acceptance instructions, test results, usage, gaps, and decisions. The feature-to-main pull request stays ready for Hanna's review when its acceptance criteria pass. Hanna reviews that result and performs the merge.

Codex-first `v0.7-alpha` enables founder testing and marketing preparation before beta. Trellis v0.7-beta precedes a separate Sagespec product team with its own lead. The approved alpha packet supplies implementation defaults and delegated engineering choices. Material scope changes and later release gates remain explicit. This campaign does not start Sagespec early.

The canonical release sequence is `v0.7-alpha`, `v0.7-beta`, `v1-beta`, and `v1-rc`. A release candidate is a build proposed for final acceptance. Legacy names such as `Sagespec v3` remain historical references. Current plans use the canonical release names. Both Codex and Claude Code are required for `v0.7-beta`. Sagespec is Hanna's flagship product built on Trellis to automate her entire business.

## Disk reserve

Measure host free space before large downloads, builds, dependency installation, and new checkouts. Keep at least 12 GiB free on this Mac. Bound expected growth before each large operation, and measure again afterward. Stop an operation if it threatens the reserve. Record measurements in the campaign log and daily review.

Do not remove existing worktrees, Docker data, or private files without founder authorization. A clean Git status does not establish that ignored files are disposable.

## Capacity amendment

On October 1, Hanna changed this campaign reserve to 5 percent. Continue until alpha is ready for demo and review or usage reaches 95 percent.

This instruction supersedes the earlier 25 percent reserve for this campaign. Preserve held allowances and room for active lead, worker, and review work.

Stop new model work if current usage is unavailable. The product default remains unchanged.
