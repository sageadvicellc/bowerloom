# Harnesses dive

Status: written with lane 3 of the v0.9 next phase. It records what the dive does, where its facts come from, and the choices made where the spec was silent.

## Terms

- Harness: the context, skills, agents, interface and tools around an engine.
- Part: one agent, skill, tool or piece of context that a harness holds.
- Dive: the path from a harness to one of its parts, and from the part to the place it comes from.
- Library: the screen that lists every part that was found, one kind at a time. It exists since the first preview.

## What the dive does

A person opens a harness. Then a skill or an agent. Then the person sees where it comes from.

1. The Harnesses screen lists the harnesses. A row opens the details of that harness.
2. The details now hold a block named Parts. It lists the parts of the harness in this order: skills, agents, tools, context. The count of each kind is in its heading.
3. A part the Library lists is a button. It opens that part in the Library, on the tab of its kind. The address is `#app/library/<kind>/<part id>`.
4. A part the Library does not list has no button. The row says so.
5. A part that the harness names and cannot find shows as missing, in the group of its kind. An id in the list of parts that the state does not hold, and that the harness does not name as missing, shows as a row: "A part named in the manifest (<id>) was not found." An empty id and `__proto__` show the same way. The empty hint shows only when the harness lists no part and names none as missing.
   - A repeated id in the list shows once.
   - An id that two parts of the scan share is told in a line, and the first part shows.
   - The state has no flag for "still loading" or "failed". It has two for a scan that is not whole: `real.stoppedEarly` and `real.onlyPartRead`. When either is set, the block says the list can be incomplete. No other flag is invented.
6. The Library details of a part now hold a block named Where it comes from. It is the new part of this lane.
7. The Library details still list the harnesses that use the part. Each is a button back to that harness.

## Where it comes from

The block reads facts the state already holds. Each line is one short sentence.

- The label of the part, such as "Made by you" or "Caveman plug-in".
- The folder the reader found it in, written with `~` for the home folder. It says whether that is the home folder or a project folder. A source with no label reads "Found in the source <name>."
- The program the folder was read for, such as Claude Code.
- A folder harness, when only that harness names the part. The block names the folder and says Bowerloom did not read the file.
- The version, when the file gives one.
- The file name, in this block only. The path is split on both slashes. Only a name that ends in md, mdc, markdown, json, jsonc, toml, yaml, yml or txt shows, for every kind including context. A dotted folder name, a path with no extension and an empty name give no file name, so no folder name of the person shows. The full path stays behind "Show details", as before.
- The count of other skills with the same text. Skills only, and only with a hash.
- When the part names a source that the scan does not hold, the block says "The source of this part is not in the scan."
- When the part names no place at all, the block says Bowerloom has no record. It does not guess.

The logic is in `apps/desktop/shared/harness/harness-dive.ts`. It is pure code with no clock and no file. The words are in `apps/desktop/renderer/harness/words-dive.ts`. The two blocks are in `apps/desktop/renderer/harness/parts/PartsOfHarness.tsx` and `PartOrigin.tsx`.

## No second screen

Hanna decided D5 B: the Harnesses module extends the Library. It adds no second screen for the same list.

- The dive adds no route, no manifest, no extension and no navigation entry.
- The route-to-spec matrix keeps its 37 rows. The 15 base routes keep their owners.
- The two blocks sit in the details column of two screens that already exist.

## No new call

The dive adds no bridge and no engine call.

- Every fact it shows is in the state that the page already holds. The reader and the store put it there.
- No golden file changes. The base golden file `base-d4c8a478.json` stays frozen. `local-calls.json`, `run-calls.json` and `module-calls.json` stay as they were.
- No purity allowlist or guard changes. The new files are under `apps/desktop/renderer/` and `apps/desktop/shared/`, so the client purity test reads them as it reads every file.
- The dive reads no file of a skill or agent beyond what the reader read before.

A later lane can add a call when a part needs a fact the state lacks. That call gets its own golden file.

## Tests

- `apps/desktop/tests/harness-dive-model.test.ts`: the order of the groups, missing parts, the origin of a part, the lines, the edge cases (empty, odd ids, Unicode, 10,000 parts), and that the state is not changed.
- `apps/desktop/tests/harness-dive-screen.test.ts`: the markup of both blocks, the way into the Library, the empty and missing states, and the rules that keep the dive to one list (no second screen, no bridge, no new golden file).
- `apps/desktop/tests/harness-dive-fixture.ts`: the fixture harnesses. A mixed one, an empty one, and parts held by a folder harness.

The frozen test inventory stays valid, because the new tests sit on top of it.

## Choices made where the spec was silent

- The spec says "skills and agents first". The dive lists skills, then agents, then tools and context. The spec does not say which of the two comes first.
- The dive lists all four kinds. The spec names two. A person who opens a harness sees every part it holds.
- The Parts block is in the details column of the Harnesses screen, not in a new view. This keeps D5 B.
- No new call. The spec says "any new bridge". The state already holds where a part comes from, so none was needed.
- Where it comes from is a block of plain lines, not a graph. The graph is the Overview.

## Not done

- No end-to-end test. The unit tests render the real screens from the fixture state.
- No edit of a skill or an agent. The dive only reads.
- The full path stays behind "Show details". The dive adds none.
- No data from runs. Lane 8 waits under D2 A.
