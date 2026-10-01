# Storage, knowledge, and data lifecycle

## Founder direction

Supabase is a conditional requirement for the supported backend. Its suitability must cover ease of use, shared knowledge, limited access, personal autonomy, and deletion. Hanna favors PostgreSQL throughout personal and company installations. That preference informs the proposed design, but it does not establish a tested deployment.

The v1 core must avoid proprietary coordination dependencies. Company knowledge can be central, while personal installations retain private work and independent execution. Optional telemetry sent to Sage Advice requires explicit consent and a deletion policy. Trellis supplies the controls. Sagespec supplies its own business policies and customer terms.

## Proposed implementation

Use PostgreSQL throughout and package Supabase with Studio for local and server installations. Keep separate stores and credentials for personal and company work. Joining a company does not move personal data into its database. Portable team definitions remain versioned files outside every harness.

PostgreSQL holds authoritative runtime and knowledge state. Rebuildable local caches do not become another source of truth. Knowledge exports include portable source files and versioned metadata. Authorized sources permit reconstruction of derived indexes.

Trellis must handle setup, startup, health reports, upgrades, backups, and recovery through documented commands and agent interfaces. Routine work must not require database administration. Studio serves administrators who want to inspect their installation. Shared employees and clients receive scoped application access.

Supabase documents self-hosted Studio and PostgreSQL-based services. Its documentation assigns maintenance and backups to the operator. Self-hosted Studio manages one project, so it does not supply a dashboard for many isolated client projects. [Self-hosting guide](https://supabase.com/docs/guides/self-hosting), [Docker guide](https://supabase.com/docs/guides/self-hosting/docker).

Propose the MIT DBOS TypeScript library for workflow recovery, with one supervised coordinator per installation. A supervisor restarts a failed process. Exclude Conductor from the core. DBOS documents integration with Supabase and recovery after a single-server restart without Conductor. This proposal needs a pinned compatibility test. [SDK license](https://raw.githubusercontent.com/dbos-inc/dbos-transact-ts/main/LICENSE), [Supabase integration](https://docs.dbos.dev/integrations/supabase), [recovery guide](https://docs.dbos.dev/production/workflow-recovery).

Local company workers receive scoped tasks through Trellis. They do not receive company administrator credentials. Automatic replacement of a failed company server remains outside this proposed first deployment. Interrupted external actions still require receipts or reconciliation before retry.

## Shared knowledge and access

Roots must support a central company knowledge store with document revisions, citations, chunks, and embeddings. An embedding represents content as numbers for retrieval. Personal and client-private corpora remain separate from company reference material. No organization gains access merely because it shares a server.

Supabase documents permission-filtered vector retrieval through Postgres row-level security, which restricts access to individual records. Its service role bypasses those rules. Trellis must enforce scoped identity and permissions across search, direct reads, files, caches, and generated answers. [Permission-based retrieval](https://supabase.com/docs/guides/ai/rag-with-permissions), [row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security).

Remote access must use encrypted connections and revocable grants. Keep privileged Studio access separate from employee and client access. Sharing retrieved content does not grant authority to act on a machine. Treat embeddings and extracted text under their source document's access and deletion rules.

## Retention and deletion

A versioned policy must name each data class, owner, purpose, retention trigger, deadline, and deletion method. Include operational records, documents, embeddings, telemetry, cached copies, exports under operator control, and backups. Keep business retention periods outside the generic framework defaults.

Optional telemetry transmission starts disabled. Consent must name the recipient, fields, purpose, and retention policy. Revocation stops new collection and transmission. Previously collected data follows the disclosed deletion policy. Operational records needed locally have their own retention policy.

Offboarding must revoke access, stop scoped workers and streams, and offer the authorized export. Revocation and retained-data deletion are separate operations. A retained copy grants no continuing monitoring permission. A soft-delete marker alone does not complete deletion.

Deletion must reach source content, derived embeddings, file objects, caches, traces, and stored workflow arguments or results. Supabase requires its Storage API for object deletion because deleting SQL metadata alone leaves the file behind. [Object deletion guide](https://supabase.com/docs/guides/storage/management/delete-objects).

Backup expiry must follow a declared schedule. A restore must reapply deletion records before serving data. Those records must survive independently of the backup being restored. Deletion receipts retain minimal evidence under their own policy. Reports must distinguish deleted data, pending backup expiry, failed deletion, and copies outside operator control.

## Acceptance and remaining choices

Alpha must demonstrate usable local setup, restart recovery, and telemetry disabled by default. Beta must test concurrent company access, personal independence, unauthorized retrieval, revocation, deletion, and restoration after deletion. Recovery tests must cover uncertain external outcomes and duplicate task delivery.

Detailed schedules and the historical Sagespec retention rules need reconciliation before adoption. PostgreSQL packaging, DBOS selection, and the single-coordinator deployment remain proposals. The Supabase requirement remains conditional on installation, resource, isolation, recovery, and deletion evidence. The linked documentation was retrieved on October 1, 2026. It does not establish a working Trellis integration.
