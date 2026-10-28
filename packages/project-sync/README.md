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
  deletes them. A run also saves the current bytes of each file just before it overwrites or deletes it. Those copies
  go once the run, or its recovery, finishes, with one exception: when a run stops on drift, the copy of the changed
  file it found is kept.
- When recovery keeps a person's version of a path, the saved original of that path moves to `kept/` in the state
  folder, which no cleanup touches. The path leaves the receipt, and the next apply targets it again.
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

### The remaining window

Each write, rename, and unlink checks the folders above its path just before it acts. A rename reads its target again
inside that last check, and an unlink compares the device and inode of its folder with the value checked a moment
before. A folder is changed to mode 0755 through a descriptor that does not follow a link. A remaining window stays
between that last check and the system call itself: a program that runs as the same user and swaps a folder or edits a
file in that instant is not caught. The project lock keeps other Bowerloom commands out; it does not stop other programs.
