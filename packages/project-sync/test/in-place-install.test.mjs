// Definition spec section 12, check 1 (adoption followed by projection back to the same engine gives files with the same
// meaning), on the SAME folder: adopt in place, then install. Locked-in parts spec, section 4 rule 2 (preserve unmanaged
// content) and check 4. A file or entry that already holds exactly what Bowerloom would write is taken over: nothing is
// written, the receipt records its original as its current state, and removal leaves it as it is. Anything that differs
// keeps the refusal. Synthetic folders only: no private paths, no real rules, no real secrets.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { entryHash, loadDefinition } from '../../../dist/packages/harness-definition/src/index.js';
import {
  applyPortable, applyPortableRemoval, planPortable, planPortableRemoval, portableDrift, readPortableReceipt,
} from '../../../dist/packages/project-sync/src/index.js';
import { applyAdoption, planAdoption } from '../../../dist/packages/adoption/src/index.js';

const sha = b => createHash('sha256').update(b).digest('hex');
const json = v => JSON.stringify(v, null, 2) + '\n';
const code = expected => e => { if (e?.code !== expected) throw new Error(`expected ${expected}, got ${e?.code}: ${e?.message}`); return true; };

function chmodTree(p) { try { const st = fs.lstatSync(p); if (st.isDirectory() && !st.isSymbolicLink()) { fs.chmodSync(p, 0o700); for (const n of fs.readdirSync(p)) chmodTree(path.join(p, n)); } } catch { /* gone */ } }

/** A Claude Code folder whose engine files hold exactly what the projection writes back, plus one unmanaged key. */
const CLAUDE = {
  'AGENTS.md': '# Rules\n\nStanding fact: tests run with npm.\n',
  '.claude/skills/review/SKILL.md': '---\nname: review\ndescription: Reviews a change before merge.\n---\n\nUse review with care.\n',
  '.claude/skills/review/references/notes.md': 'Notes.\n',
  '.claude/skills/review/scripts/check.sh': { mode: 0o755, text: '#!/bin/sh\necho ok\n' },
  '.claude/settings.json': json({
    permissions: { deny: ['Read(./.env)', 'Edit(./.env)', 'Write(./.env)'] },
    hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'npm run lint', timeout: 10 }] }] },
    outputStyle: 'Explanatory',
  }),
  '.mcp.json': json({ mcpServers: { docs: { type: 'stdio', command: 'npx', args: ['-y', 'example-docs-mcp'] } } }),
  '.claude/agents/reader.md': '---\nname: "reader"\ndescription: "A careful reader."\n---\n\nRead the files and report.\n',
};
const CLAUDE_ENGINES = [{ id: 'claude-code', version: '2.1.310' }];

/** A Codex folder: a managed table whose keys are in another order than Bowerloom writes them, and a person's own key. */
const CODEX = {
  'AGENTS.md': '# Rules\n',
  '.codex/config.toml': 'model = "model-a"\n\n[mcp_servers.docs]\nargs = ["-y", \'example-docs-mcp\']\n"command" = "npx" # the server\nstartup_timeout_sec = 20\n',
  '.codex/hooks.json': json({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'echo ready' }] }] } }),
};
const CODEX_ENGINES = [{ id: 'codex', version: '0.157.0' }];

function write(dir, files) {
  for (const [rel, value] of Object.entries(files)) {
    const at = path.join(dir, rel); fs.mkdirSync(path.dirname(at), { recursive: true });
    if (typeof value === 'object' && value.link !== undefined) fs.symlinkSync(value.link, at);
    else if (typeof value === 'object') { fs.writeFileSync(at, value.text); fs.chmodSync(at, value.mode); }
    else { fs.writeFileSync(at, value); fs.chmodSync(at, 0o644); }
  }
}

const ENTRY_LISTS = { subagents: d => d.entries.subagents, guardrails: d => [...d.entries.rules, ...d.entries.sandbox], hooks: d => d.entries.hooks, mcp: d => d.entries.mcp };

/** Adopts a synthetic folder in place, with every gated entry acknowledged. Returns the install input for the same folder. */
async function adoptInPlace(t, files, engines, edit = () => {}) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bowerloom-in-place-'))); fs.chmodSync(base, 0o700);
  t.after(() => { chmodTree(base); fs.rmSync(base, { recursive: true, force: true }); });
  const dir = path.join(base, 'project');
  fs.mkdirSync(dir, { mode: 0o755 });
  write(dir, files);
  const stateDir = path.join(base, 'state', 'adoption');
  const first = planAdoption({ projectDir: dir, stateDir, engines });
  const input = { projectDir: dir, stateDir, engines, acknowledged: first.unmapped.filter(u => u.gate === 'acknowledge').map(u => u.id) };
  const plan = planAdoption(input);
  assert.equal(plan.ready, true, JSON.stringify({ conflicts: plan.conflicts, problems: plan.problems }));
  await applyAdoption(input, plan.revision, plan.approvalsRequired);
  const def = path.join(dir, '.bowerloom');
  const loaded = loadDefinition(def);
  assert.equal(loaded.ok, true, JSON.stringify(loaded.problems));
  edit(dir);
  const install = { projectDir: dir, definitionFolder: def, stateDir: path.join(base, 'state', 'portable'), engines };
  // Recorded approvals for every enforced line the fidelity check refuses, as a person records them.
  let approvals = [];
  try { planPortable(install); } catch (e) {
    if (e.code === 'PORTABLE_FIDELITY' && e.refused) {
      approvals = e.refused.map(l => ({
        part: l.part, entry: l.entry, ...(l.field !== undefined ? { field: l.field } : {}), engine: l.engine, result: l.result,
        entryHash: entryHash(ENTRY_LISTS[l.part](loaded.definition).find(x => x.id === l.entry)), who: 'Test Person', when: '2026-10-28T10:00:00Z', reason: 'Synthetic in-place install.',
      }));
    }
  }
  return { base, dir, def, input: { ...install, approvals } };
}

/** Every file and folder of the project outside `.bowerloom`: hash and mode, plus the inode and times that a write changes. */
function snapshot(dir) {
  const out = {};
  const walk = rel => {
    for (const name of fs.readdirSync(path.join(dir, rel)).sort()) {
      const r = rel ? `${rel}/${name}` : name;
      if (r === '.bowerloom') continue;
      const st = fs.lstatSync(path.join(dir, r), { bigint: true });
      if (st.isSymbolicLink()) out[r] = `-> ${fs.readlinkSync(path.join(dir, r))}`;
      else if (st.isDirectory()) { out[r + '/'] = (Number(st.mode) & 0o777).toString(8); walk(r); }
      else out[r] = `${sha(fs.readFileSync(path.join(dir, r)))} ${(Number(st.mode) & 0o777).toString(8)} ${st.ino}:${st.mtimeNs}:${st.ctimeNs}`;
    }
  };
  walk(''); return out;
}

async function install(input) { const plan = planPortable(input); return { plan, result: await applyPortable(input, plan.revision) }; }
async function remove(input) { const plan = planPortableRemoval(input); return { plan, result: await applyPortableRemoval(input, plan.revision) }; }
const actions = plan => plan.changes.map(c => [c.path, c.action]);

const CLAUDE_PATHS = ['.claude/agents/reader.md', '.claude/settings.json', '.claude/skills/review/SKILL.md', '.claude/skills/review/references/notes.md', '.claude/skills/review/scripts/check.sh', '.mcp.json', 'AGENTS.md'];

test('check 1: adopt a Claude Code folder in place, then install for Claude Code: no refusal, no byte or mode changed, every file and entry taken over', async t => {
  const a = await adoptInPlace(t, CLAUDE, CLAUDE_ENGINES);
  const before = snapshot(a.dir);
  const { plan, result } = await install(a.input);
  assert.deepEqual(actions(plan), CLAUDE_PATHS.map(p => [p, 'take-over']));
  for (const c of plan.changes) assert.deepEqual(c.original, { sha256: c.after.sha256, mode: c.after.mode }, `${c.path}: the original is the current state`);
  assert.equal(plan.noop, false, 'the receipt is new');
  // The taken-over files and entries are visible in the plan's report and in the report apply returns.
  const shown = plan.takenOver.map(x => (x.entry === undefined ? x.path : `${x.path}: ${x.entry}`));
  for (const p of CLAUDE_PATHS) assert.ok(shown.includes(p), p);
  for (const e of ['.mcp.json: mcpServers.docs', '.claude/settings.json: permissions.deny[0]', '.claude/settings.json: permissions.deny[1]', '.claude/settings.json: permissions.deny[2]', '.claude/settings.json: hooks.PreToolUse[0]']) assert.ok(shown.includes(e), e);
  assert.deepEqual(result.report.takenOver, plan.takenOver);
  assert.deepEqual(snapshot(a.dir), before, 'nothing written: same bytes, modes, inodes, and times');
  // The receipt records every taken-over file with its original equal to its current state.
  const receipt = readPortableReceipt(a.input);
  assert.deepEqual(receipt.files.map(f => f.path), CLAUDE_PATHS);
  for (const f of receipt.files) assert.deepEqual(f.original, { sha256: f.sha256, mode: f.mode }, f.path);
  assert.equal(receipt.files.find(f => f.path === '.claude/skills/review/scripts/check.sh').mode, 0o755);
});

test('check 1: removal after an in-place install leaves every original file byte for byte and mode for mode', async t => {
  const a = await adoptInPlace(t, CLAUDE, CLAUDE_ENGINES);
  const before = snapshot(a.dir);
  await install(a.input);
  const { plan, result } = await remove(a.input);
  assert.deepEqual(actions(plan), CLAUDE_PATHS.map(p => [p, 'restore']), 'each original is the current state');
  assert.deepEqual([result.restored, result.deleted], [CLAUDE_PATHS, []]);
  assert.deepEqual(snapshot(a.dir), before, 'removal writes nothing and deletes nothing');
  assert.equal(readPortableReceipt(a.input), null);
});

test('check 1: a second install after an in-place install is a no-op', async t => {
  const a = await adoptInPlace(t, CLAUDE, CLAUDE_ENGINES);
  await install(a.input);
  const before = snapshot(a.dir);
  const receipt = readPortableReceipt(a.input);
  const again = planPortable(a.input);
  assert.equal(again.noop, true);
  assert.deepEqual(actions(again), CLAUDE_PATHS.map(p => [p, 'unchanged']));
  assert.deepEqual(again.takenOver, [], 'nothing new is taken over');
  const result = await applyPortable(a.input, again.revision);
  assert.equal(result.noop, true);
  assert.deepEqual(readPortableReceipt(a.input), receipt);
  assert.deepEqual(snapshot(a.dir), before);
});

test('check 1: drift on a taken-over file is reported as it is for a written file, and install and removal refuse', async t => {
  const a = await adoptInPlace(t, CLAUDE, CLAUDE_ENGINES);
  await install(a.input);
  fs.appendFileSync(path.join(a.dir, '.claude/skills/review/references/notes.md'), 'Edited.\n');
  fs.chmodSync(path.join(a.dir, 'AGENTS.md'), 0o600);
  assert.deepEqual(portableDrift(a.input).map(d => [d.path, d.reason]), [['.claude/skills/review/references/notes.md', 'changed'], ['AGENTS.md', 'mode']]);
  assert.throws(() => planPortable(a.input), e => code('PORTABLE_DRIFT')(e) && e.paths.length === 2);
  assert.throws(() => planPortableRemoval(a.input), code('PORTABLE_DRIFT'));
});

test('check 1: one skill file that differs from the definition refuses PORTABLE_PATH_OCCUPIED naming that file, and nothing is written', async t => {
  const a = await adoptInPlace(t, CLAUDE, CLAUDE_ENGINES, dir => fs.writeFileSync(path.join(dir, '.claude/skills/review/references/notes.md'), 'Notes, edited after adoption.\n'));
  const before = snapshot(a.dir);
  assert.throws(() => planPortable(a.input), e => code('PORTABLE_PATH_OCCUPIED')(e) && e.paths.includes('.claude/skills/review/references/notes.md') && e.paths.length === 1);
  assert.deepEqual(snapshot(a.dir), before);
});

test('check 1: a skill file whose mode differs refuses PORTABLE_PATH_OCCUPIED naming that file', async t => {
  const a = await adoptInPlace(t, CLAUDE, CLAUDE_ENGINES, dir => fs.chmodSync(path.join(dir, '.claude/skills/review/scripts/check.sh'), 0o644));
  assert.throws(() => planPortable(a.input), e => code('PORTABLE_PATH_OCCUPIED')(e) && e.paths.includes('.claude/skills/review/scripts/check.sh'));
});

test('check 1: a skill folder with an extra file, or a linked skill file, keeps refusing PORTABLE_PATH_OCCUPIED for the folder', async t => {
  const extra = await adoptInPlace(t, CLAUDE, CLAUDE_ENGINES, dir => fs.writeFileSync(path.join(dir, '.claude/skills/review/extra.md'), 'Extra.\n'));
  assert.throws(() => planPortable(extra.input), e => code('PORTABLE_PATH_OCCUPIED')(e) && e.paths.includes('.claude/skills/review'));
  const linked = await adoptInPlace(t, CLAUDE, CLAUDE_ENGINES, dir => {
    const at = path.join(dir, '.claude/skills/review/references/notes.md');
    fs.writeFileSync(path.join(dir, 'notes-elsewhere.md'), 'Notes.\n');
    fs.rmSync(at); fs.symlinkSync('../../../../notes-elsewhere.md', at);
  });
  assert.throws(() => planPortable(linked.input), e => code('PORTABLE_PATH_OCCUPIED')(e) && e.paths.includes('.claude/skills/review'));
});

test('check 1: a subagent file that differs from the rendered file keeps refusing PORTABLE_PATH_OCCUPIED', async t => {
  const a = await adoptInPlace(t, CLAUDE, CLAUDE_ENGINES, dir => fs.chmodSync(path.join(dir, '.claude/agents/reader.md'), 0o600));
  assert.throws(() => planPortable(a.input), e => code('PORTABLE_PATH_OCCUPIED')(e) && e.paths.includes('.claude/agents/reader.md'));
});

test('check 1 and check 4: one .mcp.json server that differs from the definition refuses PORTABLE_CONFLICT, and nothing is written', async t => {
  const a = await adoptInPlace(t, CLAUDE, CLAUDE_ENGINES, dir => fs.writeFileSync(path.join(dir, '.mcp.json'), json({ mcpServers: { docs: { type: 'stdio', command: 'npx', args: ['-y', 'other-docs-mcp'] } } })));
  const before = snapshot(a.dir);
  assert.throws(() => planPortable(a.input), e => code('PORTABLE_CONFLICT')(e) && e.paths.includes('.mcp.json: mcpServers.docs'));
  assert.deepEqual(snapshot(a.dir), before);
});

test('check 4: a merged settings.json keeps its unmanaged key through install and removal, and gets back an entry the person removed', async t => {
  const a = await adoptInPlace(t, CLAUDE, CLAUDE_ENGINES, dir => {
    const at = path.join(dir, '.claude/settings.json');
    const s = JSON.parse(fs.readFileSync(at, 'utf8'));
    s.permissions.deny = s.permissions.deny.filter(x => x !== 'Write(./.env)');
    fs.writeFileSync(at, json(s));
  });
  const settings = path.join(a.dir, '.claude/settings.json');
  const pre = fs.readFileSync(settings);
  const { plan } = await install(a.input);
  const change = plan.changes.find(c => c.path === '.claude/settings.json');
  assert.equal(change.action, 'replace');
  assert.deepEqual(change.original, { sha256: sha(pre), mode: 0o644 });
  const shown = plan.takenOver.filter(x => x.path === '.claude/settings.json').map(x => x.entry);
  assert.deepEqual(shown, ['hooks.PreToolUse[0]', 'permissions.deny[0]', 'permissions.deny[1]'], 'the entries already there are taken over; the file itself is not');
  const now = JSON.parse(fs.readFileSync(settings, 'utf8'));
  assert.equal(now.outputStyle, 'Explanatory');
  assert.deepEqual(now.permissions.deny, ['Read(./.env)', 'Edit(./.env)', 'Write(./.env)']);
  assert.ok(fs.readFileSync(settings, 'utf8').startsWith(pre.toString('utf8').slice(0, pre.indexOf('"Edit(./.env)"'))), 'every byte before the insertion stays');
  const { plan: removal } = await remove(a.input);
  assert.equal(removal.changes.find(c => c.path === '.claude/settings.json').action, 'restore');
  assert.deepEqual(fs.readFileSync(settings), pre, 'removal restores the pre-install bytes');
  assert.equal(fs.statSync(settings).mode & 0o777, 0o644);
});

test('check 1: adopt a Codex folder in place, then install for Codex: a TOML table with the same keys and values is taken over', async t => {
  const a = await adoptInPlace(t, CODEX, CODEX_ENGINES);
  const before = snapshot(a.dir);
  const { plan } = await install(a.input);
  assert.deepEqual(actions(plan), [['.codex/config.toml', 'take-over'], ['.codex/hooks.json', 'take-over'], ['AGENTS.md', 'take-over']]);
  assert.ok(plan.takenOver.some(x => x.path === '.codex/config.toml' && x.entry === 'mcp_servers.docs'));
  assert.deepEqual(snapshot(a.dir), before);
  await remove(a.input);
  assert.deepEqual(snapshot(a.dir), before);
});

test('check 1 and check 4: a Codex TOML table with one differing value, or an extra key, keeps refusing PORTABLE_CONFLICT', async t => {
  const edits = [
    text => text.replace('startup_timeout_sec = 20', 'startup_timeout_sec = 30'),
    text => text.replace('startup_timeout_sec = 20', 'startup_timeout_sec = 20\nenabled = false'),
    text => text.replace('startup_timeout_sec = 20', 'startup_timeout_sec = 20.0'),
  ];
  for (const edit of edits) {
    const a = await adoptInPlace(t, CODEX, CODEX_ENGINES, dir => {
      const at = path.join(dir, '.codex/config.toml');
      fs.writeFileSync(at, edit(fs.readFileSync(at, 'utf8')));
    });
    assert.throws(() => planPortable(a.input), e => code('PORTABLE_CONFLICT')(e) && e.paths.some(p => p.startsWith('.codex/config.toml: mcp_servers.docs')));
  }
});
