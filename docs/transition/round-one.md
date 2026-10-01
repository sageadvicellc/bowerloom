# Trellis round one

The founder approved the transition plan. This round turns the brief into a tested specification and a reviewable development queue.

Trellis is the open-source framework. Sagespec is Hanna's flagship product built on Trellis to automate her entire business. The delivery order is Codex-first `v0.7-alpha`, then `v0.7-beta` with Codex and Claude Code. Sagespec product development follows accepted beta. Trellis continues through `v1-beta` and `v1-rc`. Alpha enables Hanna to test and establish a baseline. A marketing and social team can prepare its campaign without beta as a dependency. This round records the milestones and does not start either team.

## Expected results

This round produces these results:

1. A repository inventory and cleanup proposal that preserves useful code and private business data.
2. A comparison of repository structures, with one recommendation for founder approval.
3. Evidence about Claude Code, Codex, and suitable open-source harnesses, including startup, shutdown, recovery, permissions, and subscription use.
4. A portability contract for configuration outside individual harnesses, with acceptance scenarios across supported tools.
5. Feasibility results for workflow execution, knowledge retrieval, and capacity control, with explicit gaps where tests cannot run.
6. A draft v1 specification, bounded alpha and beta scopes, and an ordered implementation queue.

Hanna selected `sageadvicellc/trellis` as the framework monorepo on October 1, 2026. The working branch remains `feature/trellis-v1`. The remaining specification choices stay open. The dispersed framework repositories retire after their replacements pass migration and cutover gates.

## Operating boundaries

The founder reports that the old team completed its handoff and stopped. The new effort preserves that state. GitHub shows that the listed workbench merge, release, and agent workflows are disabled. The module repositories expose only CI and sanitizer workflows.

Work runs on this Mac and uses existing subscriptions. The admission limit keeps 25 percent of reported capacity available, with an allowance for work already running. Unknown usage stops new model work. Paid fallback is disabled.

At most two workers run at once. Each worker receives one bounded assignment. Review, tests, and evidence accompany each completed result.

The daily review is scheduled for 9 a.m. America/New_York. It reports completed results, test evidence, blockers, usage, and any decisions that require the founder. A release date follows measured feasibility results, not an assumed daily output rate.

Only hannasage reviews and merges the exact candidate revision into `main`. Agents review and merge work into feature branches within the approved scope. These feature merges need peer review and relevant passing tests, without separate founder approval. coda-crew and h4n-n4 are the preferred agent identities. sagehanna is the fallback. No work in this round changes repository visibility, removes historical work, or publishes a release.

## Startup evidence

The initial inventory records 17 organization repositories and 25 open pull requests. It also records 17 local checkouts. The snapshot lives in the private campaign workspace.

Both preferred GitHub Apps completed a scoped repository metadata read. This result does not establish write permissions. The isolated checkout uses feature/trellis-v1, and the original workbench remains unchanged.

Hourly continuation and the daily review are active in this chat. The first scheduled review is October 1, 2026, at 9 a.m. Eastern. The Mac and Codex must remain available for local scheduled work.
