# Trellis

Trellis is a free, open-source toolkit that agents use to build and operate automations.

Focused skills, roles, templates, connection helpers, and commands turn a request into a reusable process. Versioned definitions stay outside individual agent tools.

Sagespec is our private Labs configuration built with Trellis. Workbench provides a place to experiment and test changes.

The framework releases are `v0.7-alpha`, `v0.7-beta`, `v1-beta`, and `v1-rc`. Alpha is Codex-first. Beta requires Codex and Claude Code.

## Current development

Hanna approved the [revised alpha](docs/transition/alpha-revision-02.md) on October 1, 2026. It pairs a reusable experiment-to-blog recipe with an interactive landing page.

The recipe targets a GitHub draft pull request and keeps publication separate. Its implementation and live acceptance are in progress.

The CLI and MCP share the intended tool operations. Use n8n for useful application connections and LangGraph for steps that need saved progress. A process does not require both.

The earlier controlled Codex demonstration and its evidence remain preserved. Code review and founder hands-on testing replace the video presentation for this revision.

- [Current alpha evidence and limits](docs/alpha/acceptance-status.md)
- [Prepared local CLI sessions](docs/alpha/local-session.md)
- [Portable Endor alpha template](examples/endor-alpha/README.md)
- [Approved alpha build](docs/transition/alpha-build-approval.md)
- [Founder requirements](docs/transition/founder-requirements.md)
- [Branch coordination and merge authority](docs/transition/working-order.md)
- [Approved monorepo cutover](docs/transition/monorepo-cutover.md)
- [Release plan through v1-rc](docs/transition/release-plan.md)
- [Specification candidate and implementation queue](docs/transition/v1-specification-candidate.md)
- [Round-one outcomes and boundaries](docs/transition/round-one.md)
- [Research evidence index](docs/transition/evidence-index.md)
- [Reproducible research fixtures](experiments/transition/README.md)
- [Historical coordinator draft](docs/coordinator-spec.md)

The current founder requirements govern conflicts with the historical draft. Hanna selected this repository as the framework monorepo. The dispersed module repositories retire after migration and cutover.
