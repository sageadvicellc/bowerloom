# Workflow audit

Date: 2026-11-07. Scope: the repeatable steps of Bowerloom lane work and of a release.

If all three of these are true, a step is a script candidate. It runs in the same order every time. It needs no judgment, so the result is pass or fail. Its inputs are known before it starts. If the next step depends on what the last step found, or if a person must choose, it stays an agent task. An agent can run a script and read its output. The script never decides for the agent.

## How the numbers were taken

- Output sizes come from one real run of `node tools/gates.mjs --json` on this branch, with dependencies installed by `npm ci`. All four steps passed.
- A token count is an estimate. This audit divides bytes by 4. The real count depends on the model's tokenizer.
- Counts of lanes and reviews come from the factory's lane registry and review log. Both files live outside this repository.
- A cell that says "not measured" means nobody measured it. This audit does not guess.

## Safety classes

- `read-only`: changes no tracked file, no remote, and no registry. It can update remote-tracking git refs and write logs and receipts under `.trellis`.
- `local-write`: changes files in the working tree or in a lane tree.
- `remote-write`: pushes, comments, labels, or opens a pull request.
- `human-only`: publish, deploy, spend, login, or secrets. An agent never runs it.

## Candidates

| Candidate | Steps | How often | Tokens saved per run | Class | Inputs | Outputs | Decision |
|---|---|---|---|---|---|---|---|
| Run the gates | Typecheck and unit tests at the root and in `apps/desktop`. Optional e2e and build. Read the result. Remove build output. | At every lane head and after every fix round. The lane registry lists 8 lanes in the beta.2 set (the `b2-*` lanes). The number of gate runs per lane is not recorded. | Measured on one run: raw output 785,068 bytes, about 196,000 tokens. The summary is 1,031 bytes, about 260 tokens. This is an upper bound, because an agent that reads only the end of a log saves less. | local-write | Repository root, optional flags | One JSON summary, one log per step in `.trellis/gates` | Script: `tools/gates.mjs`. The order is fixed and the result is pass or fail. |
| Make and remove a lane tree | Clone the repository, point `origin` at the real remote, fetch the base branch, start the branch, copy `node_modules`, check free disk. Later, check that nothing is lost, then delete. | Once per lane at the start and once at the end. 8 lanes in the beta.2 set. | Not measured. By hand it is about 7 shell calls to make and about 5 checks before a safe delete. | local-write | Slug, base branch, destination path | Marker file, JSON result | Script: `tools/lane-tree.mjs`. Deleting stays a dry run until `--apply`. |
| Scan a branch and its pull request text for private detail | Read the added lines and commit messages for home paths, session links, emails, secrets. Check the pull request body shape. | At every pull request. This lane set opened 7 pull requests. | Not measured. | read-only | Base ref, optional pull request body file, optional terms file | JSON findings, or a clean line | Script: `tools/public-scan.mjs`. A list of private names stays outside the repository. |
| Release the CLI | Preflight, gates, pack and publish dry run, publish, registry check, tag, retire old versions, claim check. | Once per release. | Not measured. | Mixed. Each step has its own class. | `release.config.json`, `release/beta.json` | Receipts under `.trellis/release`, JSON per step | Script: `scripts/release.mjs`. Publish, tag push, and retire stay human-only. |
| Write a review row to the review log | Append one JSON line with the lane, commit, reviewer, verdict, and open count. | Once per review pass. 22 rows exist for 6 of the 8 lanes. | Not measured. | local-write | Lane, full commit hash, reviewer, verdict | One appended line | Candidate for the factory. The log is outside this repository, so this repository does not carry the script. |
| Stamp the lane registry | Change a lane's status and time in the registry file. | At lane start, at each state change, and at lane end. | Not measured. | local-write | Lane id, status | One edited entry | Candidate for the factory, for the same reason. |
| Open a pull request with the house body and labels | Push the branch, open the pull request, add labels, mark it ready. | Once per lane. | Not measured. | remote-write | Branch, body file | Pull request URL | Candidate. Writing the body is judgment and stays with the agent. Pushing and labeling is a fixed sequence. Not built in this lane. |
| Retake the documentation screenshots | Build, take the lock, run the capture spec, write the images and the manifest. | When an app screen changes. | Not measured. | local-write | Optional list of shot ids | Images and manifest | Script exists: `tools/docs-visuals/capture-shots.mjs` and `capture-terminals.mjs`. Listed in the manifest. |
| Render and check the social preview | Render the card, compare it to the record. | When the card changes. | Not measured. | local-write, then read-only | Release record | Card image, pass or fail | Scripts exist: `tools/render-social-preview.mjs`, `tools/check-social-preview.mjs`. |
| Alias a website pull request preview | Wait for the Vercel build, point `pr-<number>.preview.bowerloom.ai` at it, comment. | At each push to a website pull request. | Not measured. | remote-write | Pull request number | Preview address, comment | Workflow exists: `.github/workflows/pr-preview.yml`. Keep it. The lane registry marks the previews lane as paused. |
| Build the docs site and its checks | `npm run build`, `check:links`, `check:release`, `check:exports` in `apps/docs`. | At every change to the docs. | Not measured. | local-write | None | Pass or fail per check | Candidate for a `docs` step in `tools/gates.mjs`. The step needs the docs dependencies, which are not installed in a default checkout. This audit did not run it. |
| Pack the CLI tarball | Run `tools/cli-distribution/pack.mjs` with new stage and output folders. | Once per release candidate. | Not measured. | local-write | Repository path, new folders | Tarball path, SHA-256, size, file count | Script exists. `release dry-run` now calls it. |
| Hash the desktop installers | SHA-256 of each `.dmg` and `.zip`, compare with the recorded value. | Once per release. | Not measured. | local-write, then read-only | Installer folder | `release/desktop-sha256.json`, pass or fail | Built into `release hashes` and `release verify`. |
| Check the Dock icon on a new build | Look at the icon after a build. | Once per build that changes the icon. | Not applicable. | human-only | A built app | A decision | Keep as a person's task. It needs eyes, and it must not change system settings. |
| Sort review findings into a fix round | Read findings, decide which to fix, write one brief. | Once per review pass. | Not applicable. | Not applicable | Review reports | A fix brief | Keep as an agent task. It needs judgment. |

## Built in this lane

1. `tools/gates.mjs`, with tests in `tools/test/gates.test.mjs`.
2. `tools/lane-tree.mjs`, with tests in `tools/test/lane-tree.test.mjs`.
3. `tools/public-scan.mjs`, with tests in `tools/test/public-scan.test.mjs`.

`tools/manifest.json` lists these three, the release subcommands, and the tools that already exist. A test compares the manifest with the real flags of every listed script. For the three new tools and the release script, it also compares output keys.

## What this audit could not show

- It has no count of gate runs per lane. The lane registry does not record them.
- It measured output size for typecheck and unit tests only. Nobody measured the e2e and build steps.
- It did not run the docs build. The docs dependencies are not installed here.
- The real `release dry-run` was not run. `pack.mjs --release-candidate` refuses to run while `release/beta.json` holds a published version, and it holds one today. The record must move to the next unreleased version first. The file count that `dry-run` checks is therefore not recorded in `release.config.json` yet.
- The release script used a fake `npm` and a fake pack in its tests. It has not run against the real registry.
