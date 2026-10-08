---
title: "Roadmap"
description: "Compare estimated release scenarios from the 0.7 beta through stable v1."
section: "Help"
order: 27.5
---

Bowerloom moves from project integration in the 0.7 beta toward a stable v1. The dates below are 2026 estimates, not commitments. The optimistic scenario assumes that each stage meets its review criteria without substantial rework. The pessimistic scenario allows more time for fixes and feedback, so later milestones follow the revised earlier stages.

| Stage | Intended outcome | Optimistic estimate | Pessimistic estimate |
| --- | --- | --- | --- |
| 0.7 beta handoff | Put project integration and documented limits in colleagues' hands. | Colleague soft launch: Monday, October 12. | Unresolved release defects move the handoff later. |
| 0.7.x capability additions | Add capabilities from observed use and accepted priorities. | October–November. | Additions extend beyond November if fixes or required controls take longer. |
| 1.0 beta | Bring the intended v1 capabilities into a defined, tested scope. | Around December. | After December if the 0.7.x work needs more time. |
| Release candidate | Focus on stability, installation, recovery, security, and documentation. | Toward the end of December. | After the delayed 1.0 beta and its necessary fixes. |
| Stable v1 | Release the version that meets the final criteria. | After a successful release candidate. No confirmed date. | After remaining release-candidate defects are resolved. No confirmed date. |

Capability additions are planned work, not features supplied by the current setup commands. The roadmap does not promise automatic team execution, shared company services, or unattended support. Stable v1 depends on the release candidate's results. It has no assumed calendar date.

The 0.7 beta ships `bowerloom up --team`, `ls`, `status`, the create commands, `skills.json` with `skills add`, `check`, and `sync`, and `apply`. [Current support](/docs/status/) documents them.

Future items stay separate from the beta:

- Worker launch comes after the beta. No worker starts in the 0.7 beta.
- Private npm registries and private Git repositories are future-version limits.
- A fix so that `revise` works after a project holds added content comes in a later 0.7 release.
- The 1.0 beta and stable v1 follow the stages above.

[Release notes](/docs/releases/) describes shipped changes. [Current support](/docs/status/) describes supported tasks. Discuss proposed features in [Ideas](https://github.com/sageadvicellc/bowerloom/discussions/categories/ideas).
