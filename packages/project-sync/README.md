# project-sync

`skills sync`, `apply`, recovery, migration, and the cache commands of Bowerloom 0.7, and the portable projection of
Bowerloom 0.8.

## The portable projection

`planPortable` and `applyPortable` write the portable parts of one harness definition into the project paths of each
engine: `AGENTS.md`, a `CLAUDE.md` that is the single line `@AGENTS.md` when a person accepts it, and skill folders in
`.claude/skills` and `.agents/skills`. The source is `src/portable.ts` (the plan), `src/portable-run.ts` (apply,
removal, and recovery), `src/portable-files.ts` (every read and write in the project), and `src/portable-state.ts`
(the private state folder).

A plan reads only. A person approves its revision. Apply plans again under the project lock and writes only when the
revision is the same. Locked-in parts (MCP servers, subagents, hooks, guardrails, and scripts) are not projected in
this step: the plan reports them `absent` and says that the projection is partial.

### What the private state folder keeps

The state folder holds `receipt.json`, `pending.json` while a run is unfinished, and `blobs/`, the saved bytes of files.

- Backups of the files a projection replaced stay in the state folder until removal. Removal puts them back and then
  deletes them. A run also saves the current bytes of each file just before it overwrites or deletes it; those copies
  go once the run, or its recovery, finishes.
- A restore keeps permission bits only: the read, write, and execute bits of owner, group, and others. The setuid,
  setgid, and sticky bits of a replaced file are not restored.
- A lost state folder means that Bowerloom no longer knows what it projected. The next plan treats the projected
  `AGENTS.md`, `CLAUDE.md`, and skill files as files a person made: it saves them as originals, and a later removal
  restores Bowerloom's own text. A projected skill folder is refused as occupied.
- The engine version in the receipt is recorded. The plan uses it only to decide whether Claude Code reads `AGENTS.md`
  when no `CLAUDE.md` exists (version 2.1.277 or later).

### Records are checked, not trusted

The revision of a record is a checksum, not a seal. Each record is read against a strict shape: every path must be
`AGENTS.md`, `CLAUDE.md`, or a file of a skill folder under `.claude/skills` or `.agents/skills`, and the record must
name this project. A record that fails is refused with `PORTABLE_STATE_INVALID` or `PORTABLE_STATE_FOREIGN`.
