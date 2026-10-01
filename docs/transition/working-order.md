# Trellis working order

Hanna reviews and merges completed features into `main`. The team owns implementation, peer review, and merges into feature branches within approved scope.

The founder clarified this rule on October 1, 2026. It supersedes earlier blanket merge restrictions in this campaign. The specification decision remains pending for the next implementation phase.

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

Codex-first `v0.7-alpha` enables founder testing and marketing preparation before beta. Trellis v0.7-beta precedes a separate Sagespec product team with its own lead. Feature-branch autonomy does not select the unresolved architecture or start Sagespec early. The remaining walkthrough covers recovery, access, retrieval, and acceptance gaps.

The canonical release sequence is `v0.7-alpha`, `v0.7-beta`, `v1-beta`, and `v1-rc`. A release candidate is a build proposed for final acceptance. Legacy names such as `Sagespec v3` remain historical references. Current plans use the canonical release names. Both Codex and Claude Code are required for `v0.7-beta`. Sagespec is Hanna's flagship product built on Trellis to automate her entire business.
