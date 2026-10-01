# Trellis campaign instructions

Read [the working order](docs/transition/working-order.md) before branch coordination. Read [the founder requirements](docs/transition/founder-requirements.md) for scope. Current founder instructions govern conflicting historical drafts.

Agents implement, review one another, and merge into feature branches within approved scope. Independent review and relevant passing tests precede integration. The current integration branch is `feature/trellis-v1`.

Only Hanna, through `hannasage`, reviews and merges the assembled feature into `main`. Agents never push or merge into `main`. Feature merges do not require separate founder approval.

Prefer coda-crew for coordination and h4n-n4 for workers. Use sagehanna as the fallback. Never use hannasage for agent activity.

Hanna approved the alpha build on October 1, 2026. Read docs/transition/alpha-build-approval.md for the active scope and defaults. Implement and peer-review within that scope. Preserve the stopped old team, existing history, and private business material. Keep at most two workers active and preserve 25 percent of reported subscription capacity.

Measure disk space before large operations. Preserve 12 GiB of host free space. Stop operations that threaten the reserve. Existing worktrees and Docker data need founder authorization before removal.
