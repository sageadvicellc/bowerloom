// Journey 4 on the command line: `bowerloom harness export` and `bowerloom harness import`, through the real binary. Every run gets its own HOME and
// XDG_STATE_HOME under a temporary folder. The harnesses are made up; every secret is a reference or an obviously fake value. No engine runs, and nothing from a
// bundle runs: the PATH of the binary under test is not consulted for a program.
import './support/isolate-home.js';
import test from './support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, symlinkSync, truncateSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { TestContext } from 'node:test';
import { errorCode, run, world as baseWorld } from './support/config-cli.js';
import type { World } from './support/config-cli.js';
import { renderRefusal } from '../apps/cli/src/human.js';
import { importChange } from '../apps/cli/src/harness-bundle.js';
import type { ImportRequest } from '../apps/cli/src/harness-bundle.js';
import { privateStateRoot } from '../packages/project-context/src/index.js';
import { harnessStateDirs } from '../packages/project-sync/src/index.js';
import { BUNDLE_CODES, BUNDLE_FORMAT, isEmptyHarness, BUNDLE_MESSAGES, EXPORT_PLAN_FORMAT, IMPORT_PLAN_FORMAT } from '../packages/harness-bundle/src/index.js';
import { EMPTY_HARNESS_DESCRIPTION } from '../packages/harness-bundle/src/target.js';
import { computeRevision, loadDefinition } from '../packages/harness-definition/src/index.js';

const sha = (b: Uint8Array | string): string => createHash('sha256').update(b).digest('hex');
const HEX64 = /^[a-f0-9]{64}$/;
const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
const parse = <T = Record<string, unknown>>(text: string): T => JSON.parse(text) as T;

// ---- made-up harnesses ---------------------------------------------------------------------------------------------------

const HARNESS = (id = 'demo', parts: Record<string, unknown> = {}, description = 'A demo harness.'): string => json({
  format: 'bowerloom/harness/v1beta1', id, description, engines: [{ id: 'claude-code' }, { id: 'codex' }], parts,
});
const skill = (name: string): string => `---\nname: ${name}\ndescription: Does ${name}.\n---\n\nBody of ${name}.\n`;
const agent = (name: string, extra = ''): string => `---\nname: ${name}\ndescription: A reader.\n${extra}---\n\nRead the files and report.\n`;
const PARTS = { 'system-prompt': 'instructions/AGENTS.md', skills: 'skills/', subagents: 'agents/', hooks: 'hooks.json', mcp: 'mcp.json', scripts: 'scripts/' };

/** A harness with skills, an agent, a hook, MCP servers that read references, and an executable script. */
function richFiles(extra: Record<string, string> = {}): Record<string, string> {
  return {
    'harness.json': HARNESS('demo', PARTS),
    'instructions/AGENTS.md': '# Demo\n\nStanding fact: the demo uses npm.\n',
    'skills/review/SKILL.md': skill('review'),
    'skills/review/references/notes.md': 'Review notes.\n',
    'agents/reader.md': agent('reader', 'skills:\n  - review\n'),
    'hooks.json': json({ hooks: [{ id: 'lint-on-edit', event: 'PostToolUse', matcher: 'Edit', command: '${PROJECT_DIR}/scripts/lint.sh', timeout: 30000, strength: 'advisory' }] }),
    'mcp.json': json({ servers: [
      { name: 'github', transport: 'stdio', command: 'npx', args: ['-y', 'example-github-mcp'], env: { GITHUB_TOKEN: '${GITHUB_TOKEN}' } },
      { name: 'docs', transport: 'http', url: 'https://docs.example.com/mcp', headers: { Authorization: 'Bearer ${DOCS_TOKEN}', 'X-Key': { keychain: 'docs-api' } } },
    ] }),
    'scripts/lint.sh': '#!/bin/sh\nexit 0\n',
    ...extra,
  };
}
/** A harness that holds nothing that runs or reaches a host: its plan needs no acknowledgement. */
const plainFiles = (extra: Record<string, string> = {}): Record<string, string> => ({
  'harness.json': HARNESS('plain', { skills: 'skills/' }), 'skills/review/SKILL.md': skill('review'), ...extra,
});
const NOTES = {
  'harness.json': HARNESS('noted', { skills: 'skills/', subagents: 'agents/' }),
  'skills/review/SKILL.md': skill('review'),
  'agents/reader.md': agent('reader', 'notes:\n  - wiki\n'),
  'knowledge.json': json({ sources: [{ kind: 'wiki-folder', name: 'wiki', path: 'notes' }] }),
};

interface W extends World { src: string; dst: string; out: string }
function world(t: TestContext): W {
  const w = baseWorld(t, 'bowerloom-harness-bundle-');
  const src = join(w.home, 'Projects', 'src'), dst = join(w.home, 'Projects', 'dst');
  mkdirSync(src, { recursive: true }); mkdirSync(dst, { recursive: true });
  return { ...w, src, dst, out: join(w.home, 'out.bowerloom.json') };
}
function put(dir: string, files: Record<string, string>, executable: readonly string[] = ['scripts/lint.sh']): void {
  for (const [rel, text] of Object.entries(files)) {
    const at = join(dir, '.bowerloom', rel);
    mkdirSync(dirname(at), { recursive: true });
    writeFileSync(at, text, { mode: executable.includes(rel) ? 0o755 : 0o644 });
    if (executable.includes(rel)) chmodSync(at, 0o755);
  }
}
const bl = (w: W, args: string[], cwd: string) => run(cwd, ['harness', ...args], w.env);

/** Every file and folder under a root, with its mode and content hash. */
function snapshot(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (rel: string): void => {
    for (const name of readdirSync(join(root, rel)).sort()) {
      const r = rel ? `${rel}/${name}` : name, st = lstatSync(join(root, r)), mode = (st.mode & 0o7777).toString(8);
      if (st.isDirectory()) { out[`${r}/`] = mode; walk(r); } else if (st.isSymbolicLink()) out[r] = 'link'; else out[r] = `${mode} ${sha(readFileSync(join(root, r)))}`;
    }
  };
  if (existsSync(root)) walk('');
  return out;
}

interface ExportBody { approvalRequired: boolean; code: string; revision: string; plan: { format: string; harness: string; file: string; bytes: number; revision: string; acknowledge: string | null; summary: Summary; bundleSha256: string; replaces: { bytes: number; modified: string } | null } }
interface Summary { harness: string; counts: Record<string, number>; tools: { name: string; kind: string; runsCode: boolean; command?: string; host?: string }[]; codeFiles: { path: string; why: string }[]; secrets: { kind: string; name: string; sinks: { tool: string; field: string }[] }[]; notes: { name: string }[]; foreignPaths: { path: string; line?: number }[] }
interface ImportBody { approvalRequired: boolean; revision: string; plan: { format: string; harness: string; folder: string; file: string; summary: Summary; changes: { path: string; action: string }[]; revision: string; acknowledge: string | null; bundleSha256: string; makesEmptyHarness: boolean } }

/** Exports the harness of `w.src`: plans (exit 3), then approves. Returns the revision. */
function exportOut(w: W, extra: string[] = []): ExportBody {
  const planned = bl(w, ['export', '--output', w.out, '--json', ...extra], w.src);
  assert.equal(planned.status, 3, planned.stderr + planned.stdout);
  const body = parse<ExportBody>(planned.stdout);
  const ack = body.plan.acknowledge === null ? [] : ['--acknowledge', body.plan.acknowledge];
  const done = bl(w, ['export', '--output', w.out, ...extra, ...ack, '--approve', body.revision], w.src);
  assert.equal(done.status, 0, done.stderr + done.stdout);
  return body;
}

/** Forges a bundle file whose sizes, hashes and revision are right for the given files. */
interface Rec { path: string; content: string; executable?: true }
function forge(recs: readonly Rec[], over: Record<string, unknown> = {}): Buffer {
  const sorted = [...recs].sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
  const files = sorted.map(r => {
    const bytes = Buffer.from(r.content, 'utf8');
    return { path: r.path, size: bytes.length, sha256: sha(bytes), encoding: 'utf8', data: r.content, ...(r.executable === true ? { executable: true } : {}) };
  });
  let revision: string;
  try { revision = computeRevision(sorted.map(r => ({ path: r.path, bytes: Buffer.from(r.content, 'utf8') }))); } catch { revision = `sha256:${'0'.repeat(64)}`; }
  return Buffer.from(json({ format: BUNDLE_FORMAT, harness: 'demo', generator: 'bowerloom', revision, files, knowledge: [], ...over }), 'utf8');
}
const recsOf = (files: Record<string, string>): Rec[] => Object.entries(files).map(([path, content]) => ({ path, content }));
function bundleAt(w: W, name: string, bytes: Uint8Array): string {
  const at = join(w.home, name);
  writeFileSync(at, bytes, { mode: 0o600 });
  return at;
}

// ---- the round trip ------------------------------------------------------------------------------------------------------

test('export plans with exit 3 and writes nothing; the approved run writes one new file with mode 0600 whose hash is the revision', t => {
  const w = world(t);
  put(w.src, richFiles());
  const before = snapshot(w.base);
  const human = bl(w, ['export', '--output', w.out], w.src);
  assert.equal(human.status, 3, human.stderr);
  assert.match(human.stdout, /Revision: [a-f0-9]{64}\n/);
  assert.match(human.stdout, /MCP server github \(stdio\): runs npx -y example-github-mcp/);
  assert.match(human.stdout, /MCP server docs \(http\): reaches docs\.example\.com/);
  assert.match(human.stdout, /hook lint-on-edit on PostToolUse: runs \$\{PROJECT_DIR\}\/scripts\/lint\.sh/);
  assert.match(human.stdout, /scripts\/lint\.sh {2}\(executable, sha256 [a-f0-9]{12}\)/);
  assert.match(human.stdout, /\$\{GITHUB_TOKEN\} goes to github \(env\)/);
  assert.match(human.stdout, /\$\{DOCS_TOKEN\} goes to docs \(header at docs\.example\.com\)/);
  assert.match(human.stdout, /keychain entry docs-api goes to docs/);
  assert.deepEqual(snapshot(w.base), before, 'a plan writes nothing');

  const body = exportOut(w);
  const bytes = readFileSync(w.out);
  assert.equal(sha(bytes), body.revision, 'the revision is the SHA-256 of the file');
  assert.equal(lstatSync(w.out).mode & 0o777, 0o600);
  const doc = parse<{ format: string; harness: string; files: { path: string }[] }>(bytes.toString('utf8'));
  assert.equal(doc.format, BUNDLE_FORMAT);
  assert.equal(doc.harness, 'demo');
  assert.equal(doc.files.some(f => f.path === 'knowledge.json'), false);
  assert.equal(bytes.toString('utf8').includes(w.home), false, 'no path of this computer');
  assert.deepEqual(readdirSync(w.home).filter(n => n.endsWith('.part')), [], 'no temporary file is left');
});

test('export then import into a folder with no harness: the plan writes nothing, the approval needs the acknowledgement, and the files equal the source', t => {
  const w = world(t);
  const files = richFiles();
  put(w.src, files);
  exportOut(w);
  const before = snapshot(w.dst);

  const planned = bl(w, ['import', w.out, '--json'], w.dst);
  assert.equal(planned.status, 3, planned.stderr + planned.stdout);
  const body = parse<ImportBody>(planned.stdout);
  assert.equal(body.plan.format, IMPORT_PLAN_FORMAT);
  assert.equal(body.plan.makesEmptyHarness, true);
  assert.equal(body.plan.harness, 'demo');
  assert.deepEqual(body.plan.changes.map(c => c.action), body.plan.changes.map(() => 'create'));
  assert.deepEqual(body.plan.changes.map(c => c.path).sort(), Object.keys(files).sort());
  assert.equal(body.plan.changes.at(-1)!.path, 'harness.json', 'harness.json is written last');
  assert.match(body.plan.acknowledge ?? '', HEX64);
  assert.equal(body.plan.bundleSha256, sha(readFileSync(w.out)));
  assert.deepEqual(snapshot(w.dst), before, 'the plan made no .bowerloom');

  // No acknowledgement, a wrong one, and one for another plan: each refuses, and nothing is written.
  const wrong = `${body.plan.acknowledge!.slice(0, 63)}${body.plan.acknowledge!.endsWith('0') ? '1' : '0'}`;
  for (const extra of [[], ['--acknowledge', wrong], ['--acknowledge', 'f'.repeat(64)]]) {
    const refused = bl(w, ['import', w.out, ...extra, '--approve', body.revision], w.dst);
    assert.equal(refused.status, 1, refused.stderr);
    assert.equal(errorCode(refused.stderr), 'IMPORT_NEEDS_ACKNOWLEDGEMENT');
    assert.equal(parse<{ error: { message: string } }>(refused.stderr).error.message, BUNDLE_MESSAGES.IMPORT_NEEDS_ACKNOWLEDGEMENT);
    assert.deepEqual(snapshot(w.dst), before);
  }
  const badForm = bl(w, ['import', w.out, '--acknowledge', 'abc', '--approve', body.revision], w.dst);
  assert.equal(badForm.status, 2); assert.equal(errorCode(badForm.stderr), 'USAGE');

  const done = bl(w, ['import', w.out, '--acknowledge', body.plan.acknowledge!, '--approve', body.revision, '--json'], w.dst);
  assert.equal(done.status, 0, done.stderr + done.stdout);
  const applied = parse<{ applied: boolean; revision: string; result: { written: string[]; warnings: string[] } }>(done.stdout);
  assert.equal(applied.applied, true);
  assert.equal(applied.revision, body.revision);
  assert.equal(applied.result.written.length, Object.keys(files).length);
  assert.ok(applied.result.warnings.some(x => x.includes('Nothing was installed')));
  assert.ok(applied.result.warnings.some(x => x.includes('DOCS_TOKEN') && x.includes('did not check')));
  for (const [rel, text] of Object.entries(files)) {
    const at = join(w.dst, '.bowerloom', rel);
    assert.equal(readFileSync(at, 'utf8'), text, rel);
    assert.equal((lstatSync(at).mode & 0o111) !== 0, rel === 'scripts/lint.sh', `${rel}: the execute bit`);
  }
  assert.deepEqual(readdirSync(join(w.dst, '.bowerloom')).sort(), ['agents', 'harness.json', 'hooks.json', 'instructions', 'mcp.json', 'scripts', 'skills']);
  const status = bl(w, ['status', '--json'], w.dst);
  assert.equal(parse<{ definition: { present: boolean; harness: string } }>(status.stdout).definition.harness, 'demo');
  const noInstall = bl(w, ['drift'], w.dst);
  assert.match(noInstall.stdout, /Nothing is installed/, 'the import installed nothing');
});

test('export(import(export(x))) is byte for byte equal', t => {
  const w = world(t);
  put(w.src, plainFiles());
  const first = exportOut(w);
  const bytes = readFileSync(w.out);
  const planned = parse<ImportBody>(bl(w, ['import', w.out, '--json'], w.dst).stdout);
  assert.equal(planned.plan.acknowledge, null, 'nothing runs, so nothing needs a tick');
  assert.equal(bl(w, ['import', w.out, '--approve', planned.revision], w.dst).status, 0);
  const second = join(w.home, 'again.json');
  const replanned = parse<ExportBody>(bl(w, ['export', '--output', second, '--json'], w.dst).stdout);
  assert.equal(replanned.plan.revision, first.plan.revision);
  assert.equal(replanned.plan.revision, sha(bytes), 'with no file to replace the revision is the hash of the bytes');
  assert.equal(bl(w, ['export', '--output', second, '--approve', replanned.revision], w.dst).status, 0);
  assert.ok(readFileSync(second).equals(bytes));
});

test('import goes into a folder with an empty harness; its revision is the save plan, and the plan says no empty harness is made', t => {
  const w = world(t);
  put(w.src, plainFiles());
  exportOut(w);
  put(w.dst, { 'harness.json': HARNESS('empty', {}, EMPTY_HARNESS_DESCRIPTION) });
  const planned = bl(w, ['import', w.out, '--json'], w.dst);
  assert.equal(planned.status, 3, planned.stderr);
  const body = parse<ImportBody>(planned.stdout);
  assert.equal(body.plan.makesEmptyHarness, false);
  assert.deepEqual(body.plan.changes.map(c => `${c.action} ${c.path}`), ['create skills/review/SKILL.md', 'update harness.json']);
  assert.equal(bl(w, ['import', w.out, '--approve', body.revision], w.dst).status, 0);
  assert.equal(readFileSync(join(w.dst, '.bowerloom', 'harness.json'), 'utf8'), plainFiles()['harness.json']);
  assert.equal(readFileSync(join(w.dst, '.bowerloom', 'skills/review/SKILL.md'), 'utf8'), skill('review'));
});

test('a harness with a description of its own is not an empty one, and import refuses it', t => {
  const w = world(t);
  put(w.src, plainFiles());
  exportOut(w);
  put(w.dst, { 'harness.json': HARNESS('mine', {}, 'My own words about this harness.') });
  const r = bl(w, ['import', w.out], w.dst);
  assert.equal(r.status, 1, r.stderr);
  assert.equal(errorCode(r.stderr), 'IMPORT_FOLDER_HAS_HARNESS');
});

test('an existing .bowerloom with only 0.7 files and hidden clutter counts as a missing harness, and those files stay', t => {
  const w = world(t);
  put(w.src, plainFiles());
  exportOut(w);
  mkdirSync(join(w.dst, '.bowerloom'));
  writeFileSync(join(w.dst, '.bowerloom', 'skills.json'), '{"keep":"me"}\n');
  writeFileSync(join(w.dst, '.bowerloom', '.DS_Store'), 'x');
  const body = parse<ImportBody>(bl(w, ['import', w.out, '--json'], w.dst).stdout);
  assert.equal(body.plan.makesEmptyHarness, true);
  assert.equal(bl(w, ['import', w.out, '--approve', body.revision], w.dst).status, 0);
  assert.equal(readFileSync(join(w.dst, '.bowerloom', 'skills.json'), 'utf8'), '{"keep":"me"}\n');
  assert.equal(readFileSync(join(w.dst, '.bowerloom', 'harness.json'), 'utf8'), plainFiles()['harness.json']);
});

test('import refuses a folder whose harness has parts, or whose .bowerloom holds files the loader reads, and writes nothing', t => {
  const w = world(t);
  put(w.src, plainFiles());
  exportOut(w);
  const full = join(w.home, 'Projects', 'full');
  mkdirSync(full, { recursive: true });
  put(full, richFiles());
  const loose = join(w.home, 'Projects', 'loose');
  mkdirSync(loose, { recursive: true });
  put(loose, { 'skills/mine/SKILL.md': skill('mine') });
  for (const dir of [full, loose, w.src]) {
    const before = snapshot(dir);
    const r = bl(w, ['import', w.out], dir);
    assert.equal(r.status, 1, r.stderr);
    assert.equal(errorCode(r.stderr), 'IMPORT_FOLDER_HAS_HARNESS');
    assert.deepEqual(snapshot(dir), before);
  }
});

test('a folder with a .bowerloom that is a file or a link is an unsafe path, not a missing harness', t => {
  const w = world(t);
  put(w.src, plainFiles());
  exportOut(w);
  writeFileSync(join(w.dst, '.bowerloom'), 'not a folder');
  const r = bl(w, ['import', w.out], w.dst);
  assert.equal(r.status, 1, r.stderr);
  assert.equal(errorCode(r.stderr), 'SAVE_PATH_UNSAFE');
  unlinkSync(join(w.dst, '.bowerloom'));
  const elsewhere = join(w.home, 'elsewhere');
  mkdirSync(elsewhere);
  symlinkSync(elsewhere, join(w.dst, '.bowerloom'));
  const l = bl(w, ['import', w.out], w.dst);
  assert.equal(l.status, 1, l.stderr);
  assert.equal(errorCode(l.stderr), 'SAVE_PATH_UNSAFE');
  assert.deepEqual(readdirSync(elsewhere), []);
});

// ---- json shapes ---------------------------------------------------------------------------------------------------------

test('--json: the export plan and the import plan carry the contract fields and their format strings, and the applied result has its own envelope', t => {
  const w = world(t);
  put(w.src, richFiles());
  const planned = bl(w, ['export', '--output', w.out, '--json'], w.src);
  const body = parse<ExportBody>(planned.stdout);
  assert.deepEqual(Object.keys(body).sort(), ['approvalRequired', 'code', 'plan', 'revision']);
  assert.equal(body.code, 'APPROVAL_REQUIRED');
  assert.deepEqual(Object.keys(body.plan).sort(), ['acknowledge', 'bundleSha256', 'bytes', 'file', 'format', 'harness', 'replaces', 'revision', 'summary']);
  assert.equal(body.plan.replaces, null);
  assert.equal(body.plan.format, EXPORT_PLAN_FORMAT);
  assert.equal(body.plan.file, w.out);
  assert.match(body.plan.revision, HEX64);
  assert.equal(body.plan.revision, body.revision);
  assert.equal(body.plan.acknowledge, null, 'no path of another computer, so no tick');
  assert.deepEqual(body.plan.summary.counts.mcp, 2);
  assert.deepEqual(body.plan.summary.secrets.map(s => `${s.kind}:${s.name}`).sort(), ['env:DOCS_TOKEN', 'env:GITHUB_TOKEN', 'env:PROJECT_DIR', 'keychain:docs-api']);
  assert.equal(JSON.stringify(body).includes('knowledge.json'), false);
  const done = bl(w, ['export', '--output', w.out, '--approve', body.revision, '--json'], w.src);
  const applied = parse<{ applied: boolean; revision: string; result: { written: string; bytes: number; replaced: boolean } }>(done.stdout);
  assert.deepEqual(applied.result, { written: w.out, bytes: body.plan.bytes, replaced: false });

  const imp = parse<ImportBody>(bl(w, ['import', w.out, '--json'], w.dst).stdout);
  assert.deepEqual(Object.keys(imp.plan).sort(), ['acknowledge', 'bundleSha256', 'changes', 'file', 'folder', 'format', 'harness', 'makesEmptyHarness', 'revision', 'summary']);
  assert.equal(imp.plan.folder, w.dst);
  assert.equal(imp.plan.file, w.out);
  assert.match(imp.plan.revision, HEX64);
  assert.equal(imp.plan.revision, imp.revision);
  assert.ok(imp.plan.summary.tools.some(x => x.name === 'lint-on-edit' && x.kind === 'hook' && x.runsCode));
  assert.ok(imp.plan.summary.tools.some(x => x.name === 'docs' && x.host === 'docs.example.com'));
  assert.ok(imp.plan.summary.codeFiles.some(f => f.path === 'scripts/lint.sh'));
});

// ---- wrong revision, changed plan ----------------------------------------------------------------------------------------

test('a wrong revision refuses with STALE_APPROVAL and writes nothing, for export and for import', t => {
  const w = world(t);
  put(w.src, plainFiles());
  const wrong = 'a'.repeat(64);
  const e = bl(w, ['export', '--output', w.out, '--approve', wrong], w.src);
  assert.equal(e.status, 1); assert.equal(errorCode(e.stderr), 'STALE_APPROVAL');
  assert.equal(existsSync(w.out), false);
  exportOut(w);
  const before = snapshot(w.dst);
  const i = bl(w, ['import', w.out, '--approve', wrong], w.dst);
  assert.equal(i.status, 1); assert.equal(errorCode(i.stderr), 'STALE_APPROVAL');
  assert.deepEqual(snapshot(w.dst), before);
  const malformed = bl(w, ['import', w.out, '--approve', 'abc'], w.dst);
  assert.equal(malformed.status, 2); assert.equal(errorCode(malformed.stderr), 'USAGE');
});

test('a plan that changed after it was shown is stale: an edited harness for export, a swapped bundle file for import', t => {
  const w = world(t);
  put(w.src, plainFiles());
  const plan = parse<ExportBody>(bl(w, ['export', '--output', w.out, '--json'], w.src).stdout);
  put(w.src, { 'skills/review/SKILL.md': skill('review').replace('Body', 'Changed body') });
  const e = bl(w, ['export', '--output', w.out, '--approve', plan.revision], w.src);
  assert.equal(e.status, 1); assert.equal(errorCode(e.stderr), 'STALE_APPROVAL');
  assert.equal(existsSync(w.out), false, 'the stale approval wrote nothing');

  exportOut(w);
  const imp = parse<ImportBody>(bl(w, ['import', w.out, '--json'], w.dst).stdout);
  const other = join(w.home, 'Projects', 'other');
  mkdirSync(other, { recursive: true });
  put(other, plainFiles({ 'skills/extra/SKILL.md': skill('extra') }));
  const swapped = { ...w, src: other };
  unlinkSync(w.out);
  exportOut(swapped);
  const before = snapshot(w.dst);
  const r = bl(w, ['import', w.out, '--approve', imp.revision], w.dst);
  assert.equal(r.status, 1); assert.equal(errorCode(r.stderr), 'STALE_APPROVAL');
  assert.deepEqual(snapshot(w.dst), before);
});

// ---- the acknowledgement of an export ------------------------------------------------------------------------------------

test('an export that holds a path of this computer needs --acknowledge with the hash of the plan, and the hash is bound to the plan', t => {
  const w = world(t);
  put(w.src, plainFiles({ 'instructions/AGENTS.md': `Read ${join(w.home, 'private', 'notes.md')} first.\n`, 'harness.json': HARNESS('plain', { skills: 'skills/', 'system-prompt': 'instructions/AGENTS.md' }) }));
  const planned = bl(w, ['export', '--output', w.out, '--json'], w.src);
  assert.equal(planned.status, 3, planned.stderr);
  const body = parse<ExportBody>(planned.stdout);
  assert.match(body.plan.acknowledge ?? '', HEX64);
  assert.equal(body.plan.summary.foreignPaths.length, 1);
  assert.equal(body.plan.summary.foreignPaths[0]!.path, 'instructions/AGENTS.md');
  const human = bl(w, ['export', '--output', w.out], w.src);
  assert.match(human.stdout, /Text that holds a path of another computer/);
  assert.match(human.stdout, new RegExp(`--acknowledge ${body.plan.acknowledge}`));

  for (const extra of [[], ['--acknowledge', 'e'.repeat(64)]]) {
    const r = bl(w, ['export', '--output', w.out, ...extra, '--approve', body.revision], w.src);
    assert.equal(r.status, 1, r.stderr);
    assert.equal(errorCode(r.stderr), 'EXPORT_NEEDS_ACKNOWLEDGEMENT');
    assert.equal(parse<{ error: { message: string } }>(r.stderr).error.message, BUNDLE_MESSAGES.EXPORT_NEEDS_ACKNOWLEDGEMENT);
    assert.equal(existsSync(w.out), false);
  }
  const ok = bl(w, ['export', '--output', w.out, '--acknowledge', body.plan.acknowledge!, '--approve', body.revision], w.src);
  assert.equal(ok.status, 0, ok.stderr);
  assert.ok(existsSync(w.out));
});

test('--acknowledge on a plan with nothing to acknowledge is a usage error', t => {
  const w = world(t);
  put(w.src, plainFiles());
  const body = parse<ExportBody>(bl(w, ['export', '--output', w.out, '--json'], w.src).stdout);
  assert.equal(body.plan.acknowledge, null);
  const r = bl(w, ['export', '--output', w.out, '--acknowledge', 'c'.repeat(64), '--approve', body.revision], w.src);
  assert.equal(r.status, 2, r.stderr); assert.equal(errorCode(r.stderr), 'USAGE');
  assert.equal(existsSync(w.out), false);
});

// ---- replace and the target file -----------------------------------------------------------------------------------------

test('export never replaces a file without --replace, even with a matching approval, and --replace replaces only the file it saw', t => {
  const w = world(t);
  put(w.src, plainFiles());
  writeFileSync(w.out, 'an older file\n');
  const plain = bl(w, ['export', '--output', w.out], w.src);
  assert.equal(plain.status, 1); assert.equal(errorCode(plain.stderr), 'BUNDLE_EXISTS');
  assert.equal(readFileSync(w.out, 'utf8'), 'an older file\n');
  const forced = bl(w, ['export', '--output', w.out, '--approve', 'b'.repeat(64)], w.src);
  assert.equal(errorCode(forced.stderr), 'BUNDLE_EXISTS', 'an approval does not replace');

  const planned = bl(w, ['export', '--output', w.out, '--replace', '--json'], w.src);
  assert.equal(planned.status, 3, planned.stderr);
  const body = parse<ExportBody>(planned.stdout);
  assert.deepEqual(body.plan.replaces?.bytes, 14);
  assert.match(body.plan.replaces!.modified, /^\d{4}-\d\d-\d\dT/);
  assert.notEqual(body.revision, body.plan.bundleSha256, 'with a file to replace the revision names that file too');
  assert.match(bl(w, ['export', '--output', w.out, '--replace'], w.src).stdout, /The file exists \(14 bytes, changed \S+\)\. It is replaced only if it is still that same file/);
  assert.equal(readFileSync(w.out, 'utf8'), 'an older file\n', 'a plan replaces nothing');

  // The same file changed in place after the plan is not the file the plan saw.
  writeFileSync(w.out, 'an older file, edited\n');
  const edited = bl(w, ['export', '--output', w.out, '--replace', '--approve', body.revision], w.src);
  assert.equal(edited.status, 1, edited.stderr); assert.equal(errorCode(edited.stderr), 'STALE_APPROVAL');
  assert.equal(readFileSync(w.out, 'utf8'), 'an older file, edited\n');

  // The file is swapped for another one after the plan: the approval finds a different file and refuses.
  unlinkSync(w.out);
  writeFileSync(w.out, 'a newer file that someone else wrote\n');
  const swapped = bl(w, ['export', '--output', w.out, '--replace', '--approve', body.revision], w.src);
  assert.equal(swapped.status, 1, swapped.stderr);
  assert.equal(errorCode(swapped.stderr), 'STALE_APPROVAL');
  assert.equal(readFileSync(w.out, 'utf8'), 'a newer file that someone else wrote\n');
});

test('--replace replaces the same file, and the result says so', t => {
  const w = world(t);
  put(w.src, plainFiles());
  writeFileSync(w.out, 'an older file\n');
  const body = parse<ExportBody>(bl(w, ['export', '--output', w.out, '--replace', '--json'], w.src).stdout);
  const done = bl(w, ['export', '--output', w.out, '--replace', '--approve', body.revision, '--json'], w.src);
  assert.equal(done.status, 0, done.stderr);
  assert.equal(parse<{ result: { replaced: boolean } }>(done.stdout).result.replaced, true);
  assert.equal(sha(readFileSync(w.out)), body.plan.bundleSha256);
  assert.equal(lstatSync(w.out).mode & 0o777, 0o600);
});

test('a file that appears between the plan and the approval is not replaced', t => {
  const w = world(t);
  put(w.src, plainFiles());
  const body = parse<ExportBody>(bl(w, ['export', '--output', w.out, '--json'], w.src).stdout);
  writeFileSync(w.out, 'made in between\n');
  const r = bl(w, ['export', '--output', w.out, '--approve', body.revision], w.src);
  assert.equal(r.status, 1); assert.equal(errorCode(r.stderr), 'BUNDLE_EXISTS');
  assert.equal(readFileSync(w.out, 'utf8'), 'made in between\n');
});

test('export refuses a link or a folder at the target, with or without --replace, and a target folder that does not exist', t => {
  const w = world(t);
  put(w.src, plainFiles());
  const real = join(w.home, 'real.json');
  writeFileSync(real, 'precious\n');
  const link = join(w.home, 'link.json');
  symlinkSync(real, link);
  for (const extra of [[], ['--replace']]) {
    const r = bl(w, ['export', '--output', link, ...extra], w.src);
    assert.equal(r.status, 1, r.stderr); assert.equal(errorCode(r.stderr), 'BUNDLE_FILE_UNSAFE');
  }
  const dangling = join(w.home, 'dangling.json');
  symlinkSync(join(w.home, 'nowhere'), dangling);
  assert.equal(errorCode(bl(w, ['export', '--output', dangling], w.src).stderr), 'BUNDLE_FILE_UNSAFE');
  const folder = join(w.home, 'a-folder');
  mkdirSync(folder);
  assert.equal(errorCode(bl(w, ['export', '--output', folder, '--replace'], w.src).stderr), 'BUNDLE_FILE_UNSAFE');
  assert.equal(readFileSync(real, 'utf8'), 'precious\n');
  const missing = bl(w, ['export', '--output', join(w.home, 'no', 'such', 'folder', 'x.json')], w.src);
  assert.equal(missing.status, 2); assert.equal(errorCode(missing.stderr), 'USAGE');
  // A link in the folder path: the writer sees the real folder, so the file lands there.
  const viaLink = join(w.home, 'via-link');
  symlinkSync(w.home, viaLink);
  const planned = parse<ExportBody>(bl(w, ['export', '--output', join(viaLink, 'through.json'), '--json'], w.src).stdout);
  assert.equal(bl(w, ['export', '--output', join(viaLink, 'through.json'), '--approve', planned.revision], w.src).status, 0);
  assert.ok(existsSync(join(w.home, 'through.json')));
});

test('export needs --output and a harness that loads', t => {
  const w = world(t);
  const none = bl(w, ['export', '--output', w.out], w.src);
  assert.equal(none.status, 2); assert.equal(errorCode(none.stderr), 'USAGE');
  assert.match(parse<{ error: { message: string } }>(none.stderr).error.message, /no harness to export/);
  put(w.src, plainFiles());
  const noOutput = bl(w, ['export'], w.src);
  assert.equal(noOutput.status, 2); assert.equal(errorCode(noOutput.stderr), 'USAGE');
  put(w.src, { 'harness.json': HARNESS('plain', { skills: 'skills/', mcp: 'mcp.json' }) });
  const broken = bl(w, ['export', '--output', w.out], w.src);
  assert.equal(broken.status, 1, broken.stderr); assert.equal(errorCode(broken.stderr), 'BUNDLE_INVALID');
  assert.equal(existsSync(w.out), false);
});

test('export refuses a literal secret value with BUNDLE_SECRET_FOUND, names the file, and never prints the value', t => {
  const w = world(t);
  const token = `ghp_${'q7'.repeat(18)}`;
  put(w.src, richFiles({ 'mcp.json': json({ servers: [{ name: 'gh', transport: 'stdio', command: 'tool', env: { GITHUB_TOKEN: token } }] }) }));
  const r = bl(w, ['export', '--output', w.out], w.src);
  assert.equal(r.status, 1, r.stderr);
  assert.equal(errorCode(r.stderr), 'BUNDLE_SECRET_FOUND');
  assert.match(parse<{ error: { message: string } }>(r.stderr).error.message, /mcp\.json/);
  assert.equal(r.stderr.includes(token) || r.stdout.includes(token), false);
  assert.equal(existsSync(w.out), false);
});

// ---- notes ---------------------------------------------------------------------------------------------------------------

test('notes names are left out by default; --link links one with its stored path; --leave says so; a name the file lacks is BUNDLE_USAGE', t => {
  const w = world(t);
  put(w.src, NOTES);
  exportOut(w);
  const text = readFileSync(w.out, 'utf8');
  assert.equal(text.includes('knowledge.json'), false);
  assert.equal(text.includes('"notes"'), false, 'the folder of the source stays home');

  const plan = bl(w, ['import', w.out], w.dst);
  assert.match(plan.stdout, /wiki, read by reader: left out\. Add --link wiki=<folder> to link a folder\./);
  const body = parse<ImportBody>(bl(w, ['import', w.out, '--json'], w.dst).stdout);
  assert.deepEqual(body.plan.summary.notes.map(n => n.name), ['wiki']);
  assert.equal(bl(w, ['import', w.out, '--approve', body.revision], w.dst).status, 0);
  assert.equal(existsSync(join(w.dst, '.bowerloom', 'knowledge.json')), false, 'left out by default');
  assert.doesNotMatch(readFileSync(join(w.dst, '.bowerloom', 'agents/reader.md'), 'utf8'), /notes:|wiki/);

  const linked = join(w.home, 'Projects', 'linked');
  mkdirSync(linked, { recursive: true });
  mkdirSync(join(linked, 'docs'));
  const lp = parse<ImportBody>(bl(w, ['import', w.out, '--link', 'wiki=docs', '--json'], linked).stdout);
  assert.notEqual(lp.revision, body.revision, 'the choice is part of the revision');
  assert.equal(bl(w, ['import', w.out, '--link', 'wiki=docs', '--approve', lp.revision], linked).status, 0);
  assert.deepEqual(parse<{ sources: unknown[] }>(readFileSync(join(linked, '.bowerloom', 'knowledge.json'), 'utf8')).sources, [{ kind: 'wiki-folder', name: 'wiki', path: 'docs' }]);
  assert.match(readFileSync(join(linked, '.bowerloom', 'agents/reader.md'), 'utf8'), /notes:\n {2}- wiki/);

  const home = join(w.home, 'Projects', 'home-link');
  mkdirSync(home, { recursive: true });
  const hp = parse<ImportBody>(bl(w, ['import', w.out, '--link', 'wiki=~/team-notes', '--json'], home).stdout);
  assert.equal(bl(w, ['import', w.out, '--link', 'wiki=~/team-notes', '--approve', hp.revision], home).status, 0);
  assert.equal(parse<{ sources: { path: string }[] }>(readFileSync(join(home, '.bowerloom', 'knowledge.json'), 'utf8')).sources[0]!.path, '~/team-notes');

  const fresh = join(w.home, 'Projects', 'fresh');
  mkdirSync(fresh, { recursive: true });
  const same = parse<ImportBody>(bl(w, ['import', w.out, '--leave', 'wiki', '--json'], fresh).stdout);
  assert.equal(same.revision, parse<ImportBody>(bl(w, ['import', w.out, '--json'], fresh).stdout).revision, '--leave is the default');
  for (const args of [['--leave', 'nope'], ['--link', 'nope=docs'], ['--link', 'wiki=docs', '--leave', 'wiki']]) {
    const r = bl(w, ['import', w.out, ...args], fresh);
    assert.equal(r.status, 1, `${args.join(' ')}: ${r.stderr}`);
    assert.equal(errorCode(r.stderr), 'BUNDLE_USAGE');
  }
  for (const args of [['--link', 'wiki'], ['--link', 'wiki='], ['--link', '=docs'], ['--link', 'wiki=docs', '--link', 'wiki=docs'], ['--link', 'wiki=/'], ['--link', 'wiki=../up'], ['--link', 'wiki=.hidden'], ['--leave', 'wiki', '--leave', 'wiki']]) {
    const r = bl(w, ['import', w.out, ...args], fresh);
    assert.equal(r.status, 2, `${args.join(' ')}: ${r.stdout}${r.stderr}`);
    assert.equal(errorCode(r.stderr), 'USAGE');
  }
  assert.equal(existsSync(join(fresh, '.bowerloom')), false);
});

// ---- every refusal code, with its exact words ----------------------------------------------------------------------------

test('every refusal code of the bundle is reachable from the command line with its exact words', t => {
  const w = world(t);
  put(w.src, richFiles());
  exportOut(w);
  const reached = new Set<string>();
  const check = (code: string, r: { status: number | null; stderr: string; stdout: string }, dir: string, before: Record<string, string>): void => {
    assert.equal(r.status, 1, `${code}: ${r.stderr}`);
    const { error } = parse<{ error: { code: string; message: string } }>(r.stderr);
    assert.equal(error.code, code);
    assert.ok(error.message.startsWith(BUNDLE_MESSAGES[code as keyof typeof BUNDLE_MESSAGES]), `${code}: ${error.message}`);
    assert.deepEqual(snapshot(dir), before, `${code}: nothing was written`);
    reached.add(code);
  };
  const imp = (code: string, file: string, extra: string[] = []): void => {
    const before = snapshot(w.dst);
    check(code, bl(w, ['import', file, ...extra], w.dst), w.dst, before);
  };

  imp('BUNDLE_USAGE', w.out, ['--leave', 'not-a-notes-name']);
  imp('BUNDLE_FORMAT', bundleAt(w, 'garbage.json', Buffer.from('this is not json\n')));
  const big = join(w.home, 'big.json');
  const fd = openSync(big, 'w', 0o600);
  closeSync(fd);
  truncateSync(big, 49 * 1024 * 1024);
  imp('BUNDLE_TOO_LARGE', big);
  const good = forge(recsOf(plainFiles()));
  const damaged = Buffer.from(good.toString('utf8').replace('Body of review', 'Body of reviex'));
  imp('BUNDLE_DAMAGED', bundleAt(w, 'damaged.json', damaged));
  imp('BUNDLE_PATH_UNSAFE', bundleAt(w, 'path.json', forge([...recsOf(plainFiles()), { path: '../evil.md', content: 'x\n' }])));
  const token = `ghp_${'q7'.repeat(18)}`;
  const withToken = forge(recsOf(richFiles({ 'mcp.json': json({ servers: [{ name: 'gh', transport: 'stdio', command: 'tool', env: { GITHUB_TOKEN: token } }] }) })));
  const tokenRun = bl(w, ['import', bundleAt(w, 'secret.json', withToken)], w.dst);
  assert.equal(tokenRun.stdout.includes(token) || tokenRun.stderr.includes(token), false, 'the value never appears');
  check('BUNDLE_SECRET_FOUND', tokenRun, w.dst, snapshot(w.dst));
  imp('BUNDLE_INVALID', bundleAt(w, 'invalid.json', forge(recsOf({ 'harness.json': HARNESS('demo', { mcp: 'mcp.json' }) }))));
  const link = join(w.home, 'link.json');
  symlinkSync(w.out, link);
  imp('BUNDLE_FILE_UNSAFE', link);
  const existing = join(w.home, 'exists.json');
  writeFileSync(existing, 'in the way\n');
  check('BUNDLE_EXISTS', bl(w, ['export', '--output', existing], w.src), w.home, snapshot(w.home));
  // A folder that cannot be written: the plan is made, and the write fails with the plain-words code of a failed file.
  const locked = join(w.home, 'locked');
  mkdirSync(locked);
  const lockedPlan = parse<ExportBody>(bl(w, ['export', '--output', join(locked, 'x.json'), '--json'], w.src).stdout);
  chmodSync(locked, 0o555);
  t.after(() => { try { chmodSync(locked, 0o755); } catch { /* gone */ } });
  const failed = bl(w, ['export', '--output', join(locked, 'x.json'), '--approve', lockedPlan.revision], w.src);
  check('BUNDLE_FILE_FAILED', failed, locked, {});
  assert.match(parse<{ error: { message: string } }>(failed.stderr).error.message, /permission/);
  chmodSync(locked, 0o755);
  check('IMPORT_FOLDER_HAS_HARNESS', bl(w, ['import', w.out], w.src), w.src, snapshot(w.src));
  // IMPORT_NEEDS_ACKNOWLEDGEMENT and EXPORT_NEEDS_ACKNOWLEDGEMENT have their own tests above. Reach them here again, so this one test names every code.
  const plan = parse<ImportBody>(bl(w, ['import', w.out, '--json'], w.dst).stdout);
  check('IMPORT_NEEDS_ACKNOWLEDGEMENT', bl(w, ['import', w.out, '--approve', plan.revision], w.dst), w.dst, snapshot(w.dst));
  put(w.src, { 'instructions/AGENTS.md': `See ${join(w.home, 'secret-place', 'a.md')}\n` });
  const xp = parse<ExportBody>(bl(w, ['export', '--output', join(w.home, 'x.json'), '--json'], w.src).stdout);
  check('EXPORT_NEEDS_ACKNOWLEDGEMENT', bl(w, ['export', '--output', join(w.home, 'x.json'), '--approve', xp.revision], w.src), w.home, snapshot(w.home));

  assert.deepEqual([...reached].sort(), [...BUNDLE_CODES].sort());
});

test('the terminal words of every bundle code are the sentences of the package, with a next step, and the style of the other refusals', () => {
  for (const code of BUNDLE_CODES) {
    const lines = renderRefusal(code, 'The message.').split('\n');
    assert.equal(lines.length, 4, code);
    assert.equal(lines[0], `Refused (${code}): The message.`);
    assert.equal(lines[1], BUNDLE_MESSAGES[code], `${code}: the sentence`);
    assert.match(lines[2]!, /^Next: \S/, code);
    assert.doesNotMatch(lines[2]!, /\b(?:should|may|might)\b|\w['’]\w/i, `${code}: the next step`);
    assert.notEqual(lines[2], 'Next: bowerloom help', `${code}: not the generic step`);
  }
  const source = readFileSync(new URL('../../apps/cli/src/human.ts', import.meta.url), 'utf8');
  for (const code of BUNDLE_CODES) assert.equal([...source.matchAll(new RegExp(`^ {2}${code}: \\{ sentence:`, 'gm'))].length, 1, `${code} has one REFUSALS entry`);
});

// ---- display -------------------------------------------------------------------------------------------------------------

test('text from a bundle never reaches the terminal as a control character, and --json carries it escaped', t => {
  const w = world(t);
  const esc = String.fromCharCode(27), bidi = String.fromCharCode(0x202e);
  const hostile = richFiles({
    'mcp.json': json({ servers: [{ name: 'bad', transport: 'stdio', command: 'tool', args: [`a${esc}[2J${esc}]0;title${bidi}done`] }] }),
    'instructions/AGENTS.md': `See /Users/dev/${esc}[31mred${bidi}x here\n`,
  });
  const bundle = bundleAt(w, 'hostile.json', forge(recsOf(hostile)));
  const human = bl(w, ['import', bundle], w.dst);
  assert.equal(human.status, 3, human.stderr + human.stdout);
  assert.equal(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u202e]/.test(human.stdout), false, 'no raw control or bidi character');
  assert.match(human.stdout, /\\u001b/);
  const asJson = bl(w, ['import', bundle, '--json'], w.dst);
  assert.equal(asJson.status, 3, asJson.stderr);
  assert.equal(/[\u0000-\u001f\u007f-\u009f\u202e]/.test(asJson.stdout.slice(0, -1)), false, 'JSON escapes them too');
  assert.match(asJson.stdout, /\\u001b/);
});

test('the plan never prints a secret value, and a reference is listed by name only', t => {
  const w = world(t);
  put(w.src, richFiles());
  const out = bl(w, ['export', '--output', w.out], w.src).stdout;
  assert.match(out, /DOCS_TOKEN/);
  assert.doesNotMatch(out, /Bearer /);
});

test('nothing in the harness bundle commands runs a program: the source holds no spawn, exec, fork, eval, vm or dynamic import', () => {
  const source = readFileSync(new URL('../../apps/cli/src/harness-bundle.ts', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const word of ['child_process', 'spawn', 'execFile', 'execSync', 'fork(', 'eval(', 'new Function', 'node:vm', 'import(', 'process.env']) assert.equal(source.includes(word), false, word);
});

test('the help topic lists export and import, and a bad flag is a usage error', t => {
  const w = world(t);
  const help = run(w.work, ['help', 'harness'], w.env);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /bowerloom harness export --output <file>/);
  assert.match(help.stdout, /bowerloom harness import <file>/);
  for (const args of [['export', '--output'], ['export', '--output', 'a', '--output', 'b'], ['export', '--replace', '--replace', '--output', 'a'], ['export', '--link', 'a=b', '--output', 'x'], ['import'], ['import', 'a', 'b'], ['import', 'a', '--output', 'x'], ['import', 'a', '--replace'], ['import', 'a', '--acknowledge']]) {
    const r = bl(w, args, w.work);
    assert.equal(r.status, 2, `${args.join(' ')}: ${r.stderr}`); assert.equal(errorCode(r.stderr), 'USAGE');
  }
  const missing = bl(w, ['import', join(w.home, 'missing.json')], w.work);
  assert.equal(missing.status, 2, missing.stderr); assert.equal(errorCode(missing.stderr), 'USAGE');
});

// ---- the empty harness is part of the plan -------------------------------------------------------------------------------

const stateOf = (w: W, dir: string): string => harnessStateDirs(privateStateRoot({ XDG_STATE_HOME: w.state }, w.home), dir).adoption;
function request(w: W, dir: string, file: string, extra: Partial<ImportRequest> = {}): ImportRequest {
  return { dir, stateDir: stateOf(w, dir), home: w.home, cwd: dir, file, link: [], leave: [], acknowledge: undefined, signal: new AbortController().signal, ...extra };
}

test('a state folder the save would refuse is found when the plan is made, before the empty harness is written', t => {
  const w = world(t);
  put(w.src, plainFiles());
  exportOut(w);
  for (const dir of [w.dst, join(w.home, 'Projects', 'empty')]) {
    mkdirSync(dir, { recursive: true });
    if (dir !== w.dst) put(dir, { 'harness.json': HARNESS('empty', {}, EMPTY_HARNESS_DESCRIPTION) });
    mkdirSync(stateOf(w, dir), { recursive: true, mode: 0o755 });
    chmodSync(stateOf(w, dir), 0o755);
    const before = snapshot(dir);
    const r = bl(w, ['import', w.out], dir);
    assert.equal(r.status, 1, r.stderr);
    // The guard every harness command runs refuses first; the import's own check (SAVE_STATE_UNSAFE) is the second line.
    assert.match(errorCode(r.stderr), /^(?:PORTABLE|SAVE)_STATE_UNSAFE$/);
    assert.deepEqual(snapshot(dir), before);
  }
});

async function failAfterEmpty(w: W, dir: string, hook: () => void): Promise<{ error: Error; seen: boolean }> {
  put(w.src, plainFiles());
  exportOut(w);
  let seen = false;
  const change = importChange(request(w, dir, w.out, { hooks: { afterEmpty: () => { seen = existsSync(join(dir, '.bowerloom', 'harness.json')); hook(); } } }));
  const plan = await change.plan();
  assert.equal(plan.makesEmptyHarness, true);
  let error: Error | undefined;
  try { await change.apply(plan.revision); } catch (e) { error = e as Error; }
  assert.ok(error, 'the import was refused');
  return { error: error!, seen };
}

test('a failure after the empty harness was made takes it out again, and the .bowerloom folder this command made with it', async t => {
  const w = world(t);
  let empty = false;
  const { error, seen } = await failAfterEmpty(w, w.dst, () => {
    const loaded = loadDefinition(join(w.dst, '.bowerloom'));
    empty = loaded.ok && isEmptyHarness(loaded.definition);
    throw new Error('stopped for the test');
  });
  assert.equal(seen, true, 'the empty harness was on disk when the hook ran');
  assert.equal(empty, true, 'and the package counts it as empty, as the app does');
  assert.match(error.message, /stopped for the test/);
  assert.equal(existsSync(join(w.dst, '.bowerloom')), false);
  assert.deepEqual(snapshot(w.dst), {});
});

test('the same failure in a folder that had a .bowerloom keeps that folder and its 0.7 files', async t => {
  const w = world(t);
  mkdirSync(join(w.dst, '.bowerloom'));
  writeFileSync(join(w.dst, '.bowerloom', 'skills.json'), '{"keep":"me"}\n');
  const { error } = await failAfterEmpty(w, w.dst, () => { throw new Error('stopped for the test'); });
  assert.match(error.message, /stopped for the test/);
  assert.deepEqual(readdirSync(join(w.dst, '.bowerloom')), ['skills.json']);
});

test('a file that appears between the empty harness and the save stops the import, and is never deleted or replaced', async t => {
  const w = world(t);
  for (const [rel, text] of [['agents/extra.md', agent('extra')], ['skills/review/SKILL.md', 'someone else wrote this\n']] as const) {
    const dir = join(w.home, 'Projects', rel.replace(/\W/g, '-'));
    mkdirSync(dir, { recursive: true });
    const { error } = await failAfterEmpty(w, dir, () => { mkdirSync(dirname(join(dir, '.bowerloom', rel)), { recursive: true }); writeFileSync(join(dir, '.bowerloom', rel), text); });
    // The save finds a harness that no longer loads, or one that no longer is the plan: either way it stops, and the file stays.
    assert.match((error as { code?: string }).code ?? '', /^(?:STALE_APPROVAL|SAVE_DEFINITION_INVALID|SAVE_STALE)$/, rel);
    assert.equal(readFileSync(join(dir, '.bowerloom', rel), 'utf8'), text, `${rel} stays`);
    assert.equal(existsSync(join(dir, '.bowerloom', 'harness.json')), false, 'the empty harness is out again');
    unlinkSync(w.out);
  }
});

test('a harness.json that someone else wrote in that window is not replaced and not removed, and the error says what is left', async t => {
  const w = world(t);
  const theirs = HARNESS('theirs');
  const { error } = await failAfterEmpty(w, w.dst, () => { writeFileSync(join(w.dst, '.bowerloom', 'harness.json'), theirs); });
  assert.equal((error as { code?: string }).code, 'STALE_APPROVAL');
  assert.match(error.message, /still in \.bowerloom/);
  assert.equal(readFileSync(join(w.dst, '.bowerloom', 'harness.json'), 'utf8'), theirs);
});

test('importChange: a plan made twice for the same inputs has the same revision, and a different folder has another', async t => {
  const w = world(t);
  put(w.src, plainFiles());
  exportOut(w);
  const other = join(w.home, 'Projects', 'other');
  mkdirSync(other, { recursive: true });
  const a = await importChange(request(w, w.dst, w.out)).plan(), b = await importChange(request(w, w.dst, w.out)).plan(), c = await importChange(request(w, other, w.out)).plan();
  assert.equal(a.revision, b.revision);
  assert.notEqual(a.revision, c.revision);
  assert.match(a.revision, HEX64);
});
