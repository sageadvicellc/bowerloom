// Spec 05, section 10.18: `bowerloom context show` and `context measure`, through the real command line.
import test from './support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { readInstalledRelease } from '../apps/cli/src/release.js';
import { TOPICS } from '../apps/cli/src/human.js';
import { estimateTokens, formatPercent, formatThousands, ratioPpm } from '../packages/context-slices/src/estimate.js';
import { folder, put, run, sliceProject } from './support/slice-project.js';

const errorOf = (stderr: string) => (JSON.parse(stderr) as { error: { code: string; message: string } }).error;
const tree = (dir: string): string => JSON.stringify(readdirSync(dir, { recursive: true }).map(String).sort().map(rel => { const s = lstatSync(join(dir, rel)); return [rel, s.isFile() ? createHash('sha256').update(readFileSync(join(dir, rel))).digest('hex') : 'dir', s.mtimeMs]; }));
const heading = (() => { const r = readInstalledRelease(); return `Bowerloom ${r.version}: open beta\n${r.execution}\n\n`; })();

test('1. context show wiki prints the exact text and the index', t => {
  const p = sliceProject(t), r = run(p.dir, ['context', 'show', 'wiki'], p.home), index = readFileSync(join(p.dir, '.claude/skills/slice-wiki/SKILL.md'), 'utf8');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, `Slice wiki: 2 files from wiki\nIndex: .claude/skills/slice-wiki/SKILL.md, ${Buffer.byteLength(index)} bytes (installed and the same)\nGuard: root\nAgents: lead\n\n${index}\n`);
  const json = JSON.parse(run(p.dir, ['context', 'show', 'wiki', '--json'], p.home).stdout);
  assert.equal(json.format, 'bowerloom/context-slice-show/v1beta1'); assert.deepEqual(json.members, ['a.md', 'sub/b.md']); assert.deepEqual(json.covered, ['sub/']); assert.equal(json.installed, 'installed and the same');
  assert.equal(json.index.text, index); assert.equal(json.index.bytes, Buffer.byteLength(index)); assert.equal(json.index.sha256, createHash('sha256').update(index).digest('hex')); assert.equal(json.hold, null); assert.equal(json.guard, 'root'); assert.deepEqual(json.agents, ['lead']);
});
test('1b. context show names a held slice and prints no index', t => {
  const p = sliceProject(t, { apply: false }); put(p.dir, 'wiki/bad.md', '---\nx: [oops\n---\n# Bad\n');
  const file = join(p.dir, '.bowerloom/slices/wiki.yaml'); put(p.dir, '.bowerloom/slices/wiki.yaml', readFileSync(file, 'utf8').replace('"**/*.md"', '"missing.md"'));
  const r = run(p.dir, ['context', 'show', 'wiki'], p.home); assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^Held: SLICE_PATH_MISSING\. Next: wiki\/missing\.md is gone\. Fix the path in \.bowerloom\/slices\/wiki\.yaml, or restore the file, then run bowerloom apply\.$/m); assert.doesNotMatch(r.stdout, /^---$/m);
  assert.match(r.stdout, /\(not installed\)$/m);
});
test('2. context show missing refuses CONTEXT_SLICE_NOT_FOUND', t => {
  const p = sliceProject(t), r = run(p.dir, ['context', 'show', 'missing'], p.home); assert.equal(r.status, 1); assert.equal(errorOf(r.stderr).code, 'CONTEXT_SLICE_NOT_FOUND');
  assert.equal(run(p.dir, ['context', 'show'], p.home).status, 2); assert.equal(run(p.dir, ['context', 'show', 'a', 'b'], p.home).status, 2); assert.equal(run(p.dir, ['context', 'nothing'], p.home).status, 2);
});
function expectedTable(prompt: number, index: number, baseline: number, project: string): string {
  const start = prompt + index, cells = [['Agent', 'lead'], ['Prompt', t(prompt)], ['Instructions', t(0)], ['Skills', t(0)], ['Slices', t(index)], ['At start', t(start)], ['On demand', t(29)], ['Baseline', t(baseline)], ['Start/baseline', formatPercent(ratioPpm(start, baseline))]];
  function t(b: number): string { return formatThousands(estimateTokens(b, 4000)); }
  const widths = cells.map(([h, c]) => Math.max(h!.length, c!.length));
  const row = (i: 0 | 1): string => cells.map((c, k) => (k === 0 ? c[i]!.padEnd(widths[k]!) : c[i]!.padStart(widths[k]!))).join('  ');
  return [`Context per agent. Project: ${project}. Claude Code starts in: ${project}.`, 'Unit: tokens, estimated as bytes / 4 (assumed band 3.0 to 4.5 bytes per token, not calibrated). Bytes are exact. Add --json to see them.', '', row(0), row(1),
    'Baseline: each agent with every .md file under wiki (2 files) loaded at start, and its CLAUDE.md or AGENTS.md files.',
    'Not counted: Claude Code\'s own system details and tool definitions, MCP tools, git status, the task message, managed policy files, agent memory, and files an agent reads beyond its slices.', ''].join('\n');
}
test('3. context measure prints the exact table for the fixture', t => {
  const p = sliceProject(t), r = run(p.dir, ['context', 'measure'], p.home), index = statSync(join(p.dir, '.claude/skills/slice-wiki/SKILL.md')).size;
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, expectedTable(13, index, 13 + 29, p.dir)); assert.equal(r.stderr, '');
});
test('4. context measure --json matches the fixture JSON', t => {
  const p = sliceProject(t), r = run(p.dir, ['context', 'measure', '--json'], p.home), index = statSync(join(p.dir, '.claude/skills/slice-wiki/SKILL.md')).size, j = JSON.parse(r.stdout);
  assert.equal(r.status, 0, r.stderr); assert.equal(j.format, 'bowerloom/context-measure/v1beta1'); assert.equal(j.project, p.dir); assert.equal(j.from, p.dir); assert.equal(j.executionAuthorized, false);
  assert.deepEqual(j.baseline, { folder: 'wiki', chosenBy: 'slice-roots', include: '**/*.md', files: 2, bytes: 29, skipped: { hidden: 0, links: 0, notRegular: 0 } });
  const a = j.agents[0]; assert.equal(a.role, 'lead'); assert.equal(a.start.prompt, 13); assert.equal(a.start.bytes, 13 + index); assert.equal(a.onDemand.bytes, 29); assert.equal(a.baseline.bytes, 42); assert.equal(a.notes, undefined);
  assert.equal(a.ratios.startToBaselinePpm, ratioPpm(13 + index, 42)); assert.equal(j.assumptions.length, 8); assert.equal(j.estimator.calibrated, false);
  assert.equal(r.stdout.endsWith('\n') && r.stdout.indexOf('\n') === r.stdout.length - 1, true, 'one JSON object on one line');
  assert.equal(run(p.dir, ['context', 'measure', '--json'], p.home).stdout, r.stdout);
});
test('5. context measure --agent nobody refuses CONTEXT_AGENT_NOT_FOUND', t => {
  const p = sliceProject(t), r = run(p.dir, ['context', 'measure', '--agent', 'nobody'], p.home); assert.equal(r.status, 1); assert.equal(errorOf(r.stderr).code, 'CONTEXT_AGENT_NOT_FOUND');
  assert.equal(run(p.dir, ['context', 'measure', '--agent', 'lead'], p.home).status, 0);
});
test('6. context measure --baseline /nonexistent refuses CONTEXT_BASELINE_INVALID', t => {
  const p = sliceProject(t), r = run(p.dir, ['context', 'measure', '--baseline', '/nonexistent'], p.home); assert.equal(r.status, 1); assert.equal(errorOf(r.stderr).code, 'CONTEXT_BASELINE_INVALID');
  const ok = run(p.dir, ['context', 'measure', '--baseline', p.dir, '--json'], p.home); assert.equal(ok.status, 0, ok.stderr); assert.equal(JSON.parse(ok.stdout).baseline.chosenBy, 'flag');
});
test('7. context measure --from <parent> prints the discovery note', t => {
  const p = sliceProject(t), r = run(p.dir, ['context', 'measure', '--from', p.home], p.home); assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, new RegExp(`^ {2}lead: Claude Code started in ${p.home.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')} does not find this agent\\. It finds agents only in the folders above where it starts\\. Start it inside ${p.dir.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}, or pass --add-dir ${p.dir.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}\\.$`, 'm'));
});
test('8. context measure makes no network call and writes nothing', t => {
  const p = sliceProject(t), before = [tree(p.dir), tree(join(p.home, 'state'))];
  for (const args of [['context', 'measure'], ['context', 'measure', '--json'], ['context', 'show', 'wiki'], ['context', 'measure', '--bytes-per-token', '3.5', '--user']]) { const r = run(p.dir, args, p.home, { env: { ...process.env, HOME: p.home, XDG_STATE_HOME: join(p.home, 'state'), HTTPS_PROXY: 'http://127.0.0.1:9', HTTP_PROXY: 'http://127.0.0.1:9', NODE_OPTIONS: '' } }); assert.equal(r.status, 0, args.join(' ') + r.stderr); }
  assert.deepEqual([tree(p.dir), tree(join(p.home, 'state'))], before);
});
test('9. help context prints TOPICS.context', t => {
  const home = folder(t), r = run(home, ['help', 'context'], home); assert.equal(r.status, 0); assert.equal(r.stdout, heading + TOPICS.context);
  assert.match(TOPICS.context!, /^Usage:\n {2}bowerloom slice create /); assert.equal(dirname(home).length > 0, true);
});
test('measure flags: a bad --bytes-per-token and a repeated flag exit 2', t => {
  const p = sliceProject(t);
  for (const args of [['--bytes-per-token', '0.5'], ['--bytes-per-token', 'x'], ['--bytes-per-token'], ['--from'], ['--user', '--user'], ['--team', 'a', '--team', 'b'], ['--nothing']]) assert.equal(run(p.dir, ['context', 'measure', ...args], p.home).status, 2, args.join(' '));
  const cal = run(p.dir, ['context', 'measure', '--bytes-per-token', '3.5'], p.home); assert.match(cal.stdout, /^Unit: tokens, estimated as bytes \/ 3\.5 \(calibrated by you\)\. Bytes are exact\. Add --json to see them\.$/m);
});
