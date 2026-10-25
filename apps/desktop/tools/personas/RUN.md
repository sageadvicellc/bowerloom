# Run a persona round

The main session runs a round at each milestone. It costs no extra money, because each persona is one subagent.

1. Build the app: `npm --prefix apps/desktop run bundle`. A stale build stops `serve` with a message.
2. Pick a dated folder outside the repository, such as `<scratchpad>/personas-2026-10-25`. Never use a folder inside the repository.
3. Start the driver in the background: `npm --prefix apps/desktop run personas:serve -- --id main --out <folder>/out`. Read the printed paths.
4. Choose one server for all four personas, run one at a time. Or start four servers with `--id layperson`, `--id senior-dev`, `--id designer` and `--id it-security`.
5. Open `subagent-brief.md`. Fill in the id, the out folder and the persona text. Paste the whole persona file into the brief.
6. Spawn one subagent per persona with that brief. Use a general-purpose agent and the sonnet model.
7. With one shared server, run `goto welcome` between personas, so each one starts from the first minute.
8. Each persona returns one report in the shape of `REPORT-FORMAT.md`. Save each report in the dated folder.
9. Stop each server with `node tools/personas/drive.mjs --id <id> stop`. The driver removes the data folder that it made, and nothing else.
10. Read the four reports and the `transcript.txt` in each out folder. When you file a finding, quote the transcript.
11. Screenshots and transcripts stay in the dated folder. The driver refuses to write inside the repository.
