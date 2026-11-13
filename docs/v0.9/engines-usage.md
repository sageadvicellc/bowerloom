# Engines and usage

Status: written with lane 5 of the v0.9 next phase. This page records what the module does. It says where each fact comes from. It says how secrets stay off the screen. It lists the choices made where the spec was silent.

## Terms

- Engine: a program that runs the agents, such as Claude Code or Codex.
- Module: a stock extension that ships inside the app. The Modules view lists it (`docs/v0.9/modules-view.md`).
- Config: what an engine has set up on this computer. Bowerloom reads it. It never writes it from this module.
- Usage: what the session log of an engine says a run used.
- Gap: a figure that was not read. The screen shows it as "Not read". It never shows a zero or a guess in its place.

## What it does

The module shows one card for each engine Bowerloom detects. Each card has two parts.

- Config. The state of the engine (Ready, Config file has a problem, Not found). Where Bowerloom found it. Whether the install and start sheets offer it. Whether Bowerloom writes its files. The count of skills, agents, connections, hooks and saved prompts. The folders it was read in. The connections, by name, with one line about each.
- Usage. The runs recorded for the engine. How many logs were read. The sums of the input, the output and the time of the runs whose log held them. The models the logs named.

It is a stock extension. Its id is `engines-usage`. Its manifest is `apps/desktop/extensions/engines-usage/manifest.json`. It has no route of its own in the route table. It opens at the generic address `#app/extension/engines-usage` (`#sample/extension/engines-usage` in the sample launch). It also runs inside the Modules view at `#app/modules/engines-usage`.

D3 A holds: it loads only from the app's own files. D4 A holds: it builds no terminal app.

## Which engines

The cards follow the engines the reader already detects: the three of the Interfaces screen (Claude Code, Codex, OpenCode), in that order. A detected engine is one whose health is Ready or Config file has a problem. An engine that was not found still has a card. It shows its state and nothing else of its config.

An engine with runs on record that is not one of the three gets a card after them. Its card shows the usage and says that Bowerloom reads no folder of that engine yet. A run of a name that is no engine of the app makes no card.

## Where the facts come from

No new call was needed. Every fact comes from something that already exists.

- Config comes from the state the page already holds. The reader of the person's folders built it (`apps/desktop/shared/harness/real-map.ts`). The module counts the parts by the engine their source was read for.
- Usage comes from two calls of the `bowerloomRuns` bridge (PR 183): `listRuns` and `readRunFigures`. The module reads the logs of the 50 newest runs, one at a time. It calls no other call of that bridge.

The module adds two optional fields to the state: `Part.hasSecret` and `Part.secretUnchecked`. Both are flags on a connection. The check function is `extraSecretCheck` in `apps/desktop/shared/harness/real-map.ts`. Section "Secrets" says what they mean.

## Usage rules

- Each number on screen is a sum of numbers that a log held. Nothing is estimated, averaged or rounded up.
- A figure that no log held reads "Not read". A zero that a log held reads "0".
- When some runs gave a figure and others did not, the value says so: "1,500 (from 2 of 3 runs)".
- A log that was read in part can give a low sum. The value carries the mark "may be low". A log found among too many may not be the right one. The value carries the mark "may be wrong". A log that is still being written can change. The value carries a change mark. The marks join: "5 (from 1 of 2 runs, may be low)".
- "Logs read" is x of all the runs of that engine. When the cap left out every run of an engine, the card says so.
- The module checks every answer of the two calls. A list that is no list, a run with a bad shape, or figures with a bad shape never reach the screen. A bad list is a failed read with the code FAILED. Bad figures are that run's refused read.
- The read always ends in a state. If a read fails after a good one, the card keeps the good figures and says that the last read failed.
- Runs that name an engine the app does not know are left out before the cap. One note counts them.
- The reason a figure is missing uses the words of the log reader (`figuresStateWords` in `apps/desktop/shared/harness/runs-real.ts`). The module counts runs with the same reason: "2 runs: No session log found."
- A refused read of one run is that run's gap, with the words of its refusal code. The other runs are still read.
- Some engines have no log reader. Their runs say "Figures are not available for this engine." The module does not guess which engines those are. It reads that from the answer of each run.
- The module counts only recorded runs. A run the person did not record in Runs has no figure here. The module does not read a session log that no recorded run points to.
- When more than 50 runs are recorded, the module reads the newest 50 and says so: "Read the newest 50 of 90 runs. Older runs are not counted."
- The sample launch has no session logs. It says so, and it shows no usage.
- A window with no runs bridge says so. A list that cannot be read shows the words of its code.

## Config rules

- A count of 0 for a found engine is a count that the reader made: it looked and found none. After a partial read, or when the config of the engine has a problem, each count carries the low mark. A 0 is never bare.
- A part whose folder is not in the list is counted in one note. It is never dropped without a word. A part of a Bowerloom harness folder has no source of its own, and it is not counted as lost.
- A health word the app does not know shows as a problem.
- A part found in two engines is one part with one source, so it counts once, under the first engine. The view says so in one line.
- A list of connections shows the first 12. A list of folders shows the first 6. The count is always the whole count. The rest reads "and N more".

## Secrets

A config view never shows a secret.

- The reader keeps the name of a key and never its value. This module goes further: it shows neither.
- A connection whose config holds a secret has one flag, `hasSecret`. The reader sets it if a variable, a header or a bearer variable of that connection looks like a secret. The part also gets the flag when a name in its summary holds `PAT` as a word, or is a connection string. The flagged names are `DATABASE_URL`, `DB_URL`, `REDIS_URL`, `MONGO_URL`, `MONGODB_URL`, `POSTGRES_URL`, `POSTGRESQL_URL` and `MYSQL_URL`, the same names ending `_URI`, and `CONNECTION_STRING`, bare or after a prefix. The `dsn` name was already known. A plain `BASE_URL` or `API_URL` is an address, and it gets no flag.
- When the summary of a connection is cut, empty or damaged, the check could not be made. The connection says "Secret: not checked".
- A secret in the command, its arguments or the address is not seen. The reader drops those three before this module sees the part. Fixing that means editing `shared/real/adapters.ts` and `map-world.ts`. The engine API golden file holds their hashes, and that file is frozen, so this lane leaves them alone.
- After a partial read, a connection with no flag says "Secret: not checked". It never implies that there is no secret.
- The world item that the reader builds still holds the name of the variable (`secret.name` in `map-world.ts`). That is older than this lane. This module never shows it. The module shows "Secret: set" and nothing more about it. It shows no name of a variable or header and no value.
- The module reads no `fileText` of any part. That text holds the names of variables.
- Every string that comes from the state passes through the scrub of the reader (`scrubText`, `cleanLine`) a second time. That covers a name, a line, a folder and the place where an engine was found. It also covers every model name that a log gave.
- Tests prove it with made-up homes that hold fake keys, tokens, passwords and `env` values for the three engines. Neither the fake values nor the names of the variables that hold them appear in the view or in the markup (`apps/desktop/tests/engines-usage-secrets.test.ts`).

## What it adds, and what it leaves alone

- No call. The 39 engine calls, the 3 reader calls, the local calls, the 5 runs calls and the module calls keep their lists.
- No golden file. No frozen golden file is edited.
- No purity allowlist, no word guard and no bridge guard is widened. The new files sit under `apps/desktop/renderer/` and `apps/desktop/shared/`, so the client purity test and the word test read them as they read every file.
- No route in the route table, so the route-to-spec matrix keeps its rows. The extension uses the generic address, as the template extension does.
- No change to `docs/v0.9/extension-api.md`.

### Shared lines this lane touches

- `apps/desktop/renderer/harness/extension-mounts.tsx`: one import and one line in `BUNDLED_MOUNTS`.
- `apps/desktop/renderer/harness/modules/embeds.tsx`: one import and one line in `EMBEDS`.
- `apps/desktop/shared/local-models/sample.ts`: the constant `ENGINES_USAGE_MANIFEST`, and its entry in the list of the sample bridge.
- `apps/desktop/shared/harness/types.ts` and `apps/desktop/shared/harness/real-map.ts`: the optional fields `Part.hasSecret` and `Part.secretUnchecked`, and `extraSecretCheck` with the lines that set them.
- Tests that pinned a list of modules now assert that the list includes this module: `extensions-host.test.ts`, `local-models-screen.test.ts`, `local-models-view-model.test.ts`, `extension-template.test.ts` and the e2e spec `harness-modules.spec.ts`.

## Tests

- `apps/desktop/tests/engines-usage-model.test.ts`: the rows, the counts, the gaps, the sums, the cut lists, the hidden text, size and odd input, and the words.
- `apps/desktop/tests/engines-usage-read.test.ts`: the two read calls, the order, the cap, the refusals, the stop, and `settleRead`: a rejected read clears the busy mark and becomes a failed state.
- `apps/desktop/tests/engines-usage-screen.test.ts`: the markup of each state, the registration, the address, and that the lane adds no call and no golden file.
- `apps/desktop/tests/engines-usage-secrets.test.ts`: the fake secrets.
- `apps/desktop/tests/engines-usage-real.test.ts`: the real reader on small homes: harness parts are no orphans, which names flag a secret, and a cut summary says not checked.
- `apps/desktop/tests/engines-usage-fixture.ts`: the fixture engine setups.
- `apps/desktop/e2e/harness-engines-usage.spec.ts`: the sample launch.

No new bridge means no new golden file. The test `it adds no golden file and edits none` holds that.

## Choices made where the spec was silent

- Usage counts recorded runs only. The spec says "usage". The only usage figures that exist are the figures of recorded runs. A call that reads every session log of an engine is a new call. This lane does not add one.
- The engines are the three of the Interfaces screen, plus any engine that has a recorded run.
- The module opens at the generic extension address and has no route of its own.
- The cap is 50 runs. The spec names no number.
- Secrets show as "Secret: set". The module hides the names of variables too.
- The module reads usage once at the start, and again on a press of Read again. It does not read on a timer, because a read opens log files.

## Not done

- No read of usage that no recorded run points to.
- No per-engine edit of config. The module only reads.
- No terminal app (lane 5b, D4 A).
- No end-to-end test of the real launch. The unit tests hold the bridge reads and the secrets.
- A part found in two engines counts under one. The state holds one source for each part, so a per-engine count of shared parts needs a new fact.
- Only the first copy of a connection within one scope is name-checked for the extra names. `map-world.ts` keeps one file for each program in each scope, and fixing that needs that frozen file.
- A log that is both capped and still being written reads "may change" without "may be wrong", because the log reader gives one reason for each log.
