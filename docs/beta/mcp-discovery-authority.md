# Discovery authority

This internal controller records permission before an adapter contacts an MCP server.
It supports synthetic discovery only. It does not authorize tool calls or expose a public connection command.

## Reviewed inputs

A proposal pins the complete discovery plan, its scope, its ownership epoch, and its contact specification.
The contact specification describes the exact process or destination that the trusted adapter can use.

For stdio, it names the executable, source digests, arguments, working directory, and secret references.
The process does not inherit an environment through this specification.
For HTTP, it pins the endpoint and authentication binding revision.
Secret references identify private credentials. They contain no credential value.

A trusted host supplies the owner, approvers, active epoch, and lease.
The controller authenticates approval and dispatch separately.
Approval names the exact proposal revision and an expiry within the active authority.
Changing a contact specification needs a new proposal and approval.

## Durable dispatch

The PostgreSQL store keeps one operation per scope.
It uses a locked row, a version marker, and a checksum for each state record.
The checksum detects accidental changes. It does not protect data from a database administrator.
Use an authenticated pool with access limited to this service.

The controller commits an intent before it calls the adapter.
A second locked transaction checks current permission before the adapter starts.
This transaction orders a concurrent stop or revocation against the start of contact.
The adapter call starts inside that transaction without waiting for the session to finish.

An interrupted or uncertain operation stays held for reconciliation.
The controller does not retry contact automatically or accept a caller-supplied success record.
A completed operation returns its saved result without opening another connection.
An unknown commit result requires inspection of durable state before any further action.

## Stop and recovery

A stop blocks contact that did not start.
A local active controller also signals its session to stop.
A stop from another process does not prove that a running remote process ended.
A future supervisor must enforce that boundary before production transport acceptance.

Recovery changes an unfinished intent into a reconciliation hold.
It does not infer that a missing result means that no contact occurred.
Retain the operation record when a host restarts or an adapter fails.

## Current limits

The adapter remains trusted application code.
It must remeasure executable and source bytes before launch and enforce the pinned destination.
The controller does not supply a process sandbox, credential resolver, or network firewall.
The tests for this slice use synthetic adapters and a dedicated local PostgreSQL database.
They do not establish native harness isolation or production OAuth compatibility.

The existing alpha write broker remains unchanged.
Supabase/PostgreSQL and MIT DBOS remain the campaign backend requirements.
Issue #54 stays open for production adapters, credential handling, and denial of alternative native routes.
