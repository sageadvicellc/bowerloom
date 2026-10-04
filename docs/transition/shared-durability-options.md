---
type: comparison
status: checked
created: 2026-10-01
updated: 2026-10-01
brief: evidence-index.md#shared-durability-follow-up
check: evidence-index.md#shared-durability-follow-up
audience: Hanna
---

# Company and personal Trellis

## Summary

Offer Supabase as an optional company deployment target, with portable PostgreSQL underneath and lightweight personal storage alongside it. This is a proposal for Hanna, not a technology selection. Keep the workflow engine, which coordinates execution and recovery, open until failure tests establish its fit.

## Proposed boundaries

Employees use one company server while their personal installations remain independently useful. Company authority governs company tasks and approvals. Personal authority governs private work, credentials, and state. Both operate simultaneously.

Company participation requires explicit access to named workspaces and capabilities. Personal work continues during company outages. Reconnection resolves stale ownership and uncertain actions before company execution resumes. Company membership grants no automatic permission to consume personal subscription capacity. These are proposed acceptance requirements, not demonstrated behavior.

## Storage and execution

Supabase adds services and operational duties around PostgreSQL. Its documented full-stack minimum is 4 GB RAM, two cores, and 40 GB SSD. Operators own updates, security, backups, availability, and monitoring. These figures do not describe PostgreSQL alone or a reduced stack. [sd-F1: Docker guide](https://supabase.com/docs/guides/self-hosting/docker), [self-hosting responsibilities](https://supabase.com/docs/guides/self-hosting).

Supabase Queues limits its delivery guarantee to a visibility window, when a message stays hidden from other consumers. Cron schedules calls. Engineering inference: neither documented primitive establishes Trellis approvals, recovery, or once-only external actions. The wider Supabase ecosystem is outside that conclusion. [sd-F2: Queues](https://supabase.com/docs/guides/queues), [Cron](https://supabase.com/docs/guides/cron).

DBOS documents PostgreSQL and Supabase integration through direct or session-mode connections. Transaction pooling is unsuitable. Its guide does not establish compatibility with a pinned self-hosted Supabase release. [sd-F4: production checklist](https://docs.dbos.dev/production/checklist), [Supabase integration](https://docs.dbos.dev/integrations/supabase).

DBOS TypeScript specifies PostgreSQL. Its Python guide supports SQLite locally and PostgreSQL, but excludes SQLite from distributed applications. TypeScript SQLite support remains unestablished. One TypeScript engine therefore entails PostgreSQL on personal machines under the documented design. Python introduces orchestration and integration work. [sd-F3: TypeScript configuration](https://docs.dbos.dev/typescript/reference/configuration), [Python connections](https://docs.dbos.dev/python/tutorials/database-connection).

DBOS documents pending-work recovery after a server restart. Distributed self-hosters manage executor identities and recovery. Automatic replacement of a permanently lost executor without Conductor remains unestablished. [sd-F5: workflow recovery](https://docs.dbos.dev/production/workflow-recovery).

The DBOS TypeScript SDK uses MIT. Self-hosted Conductor is proprietary and requires a paid key for commercial or production use. It also requires a production agreement and additional services. Its startup validates the key online. No price is established. These are documented terms, not legal advice. [sd-F6: SDK license](https://raw.githubusercontent.com/dbos-inc/dbos-transact-ts/main/LICENSE), [Conductor guide](https://docs.dbos.dev/conductor/self-hosting/hosting-conductor).

Temporal offers an MIT self-hosted server and external workers. Operators manage deployment and schema changes. Self-hosted role permissions and audit logging require additional work. Lost activities follow timeout and retry policies. Cancellation depends on worker cooperation. This alternative merits evaluation if beta requires automatic coordinator replacement. [sd-F9: license](https://raw.githubusercontent.com/temporalio/temporal/main/LICENSE), [deployment](https://docs.temporal.io/self-hosted-guide/deployment), [production checklist](https://docs.temporal.io/self-hosted-guide/production-checklist). [sd-F10: workers](https://docs.temporal.io/workers), [activity execution](https://docs.temporal.io/activity-execution).

## Limits that remain

DBOS distinguishes retryable attempts from recorded completed steps. It does not automatically interrupt an executing step on cancellation. Engineering inference: Trellis must reconcile uncertain external effects before retry and report effects that continue after cancellation. [sd-F7: workflows](https://docs.dbos.dev/typescript/tutorials/workflow-tutorial). [sd-F8: workflow management](https://docs.dbos.dev/typescript/tutorials/workflow-management).

## Decisions for Hanna

1. Personal setup: retain the SQLite/journal target and fund Trellis recovery work, use Python DBOS, or accept PostgreSQL everywhere with TypeScript DBOS.
2. Company recovery: accept a supervised coordinator with explicit downtime, or expand the Temporal evaluation for automatic replacement. Conductor adds proprietary production licensing.
3. Supabase scope: begin with PostgreSQL alone, or include selected Supabase services and their operational duties.

## Gaps

No runtime, isolation, recovery, approval, cancellation, migration, or performance test ran in this research. Beta must test independent personal use and simultaneous company participation. Tests must cover outages, access revocation, stale ownership, uncertain effects, and reconnection.

Resource and operating costs for Trellis, personal PostgreSQL, DBOS, and Temporal remain unmeasured. Temporal personal packaging and compatibility with a selected Supabase release remain open. A local journal alone does not provide an execution engine.

## Sources

The linked primary sources support facts sd-F1 through sd-F10. All were retrieved independently on October 1, 2026. The guides are undated living documents. Before implementation, pin releases and make sure that their documentation, terms, and behavior support the selected design.
