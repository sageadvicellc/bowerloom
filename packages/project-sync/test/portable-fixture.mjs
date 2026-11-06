// Synthetic projects for the portable projection tests. No private paths, no real rules, no real secrets.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { canonicalJson } from '../../../dist/packages/contracts/src/index.js';
import { ENGINE_IDS } from '../../../dist/packages/harness-definition/src/index.js';
import { applyPortable, planPortable } from '../../../dist/packages/project-sync/src/index.js';

export const sha = b => createHash('sha256').update(b).digest('hex');
export const FIVE = ENGINE_IDS.map(id => ({ id }));
export const code = expected => error => error?.code === expected;
export const json = v => JSON.stringify(v, null, 2) + '\n';
export const skill = (name, extra = '', body = `Use ${name} with care.\n`) => `---\nname: ${name}\ndescription: Reviews a change before merge.\n${extra}---\n\n${body}`;
export const INSTRUCTIONS = '# Demo\n\nStanding fact: the demo uses npm.\n\n## Tool guidance\n\nSearch before you read.\n';
const DEFAULT_PARTS = { 'system-prompt': 'instructions/AGENTS.md', skills: 'skills/', 'tool-guidance': ['instructions/AGENTS.md#Tool guidance'] };

export function chmodTree(p) { try { const st = fs.lstatSync(p); if (st.isDirectory() && !st.isSymbolicLink()) { fs.chmodSync(p, 0o700); for (const n of fs.readdirSync(p)) chmodTree(path.join(p, n)); } } catch { /* gone */ } }

/**
 * A project with a `.bowerloom` definition, and a private state folder outside it. `parts` is merged into the default
 * parts; `noDefaults` drops them. A file whose text is null is left out.
 */
export function project(t, { engines = FIVE, files = {}, parts = {}, skills = {}, noDefaults = false } = {}) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bowerloom-portable-'))); fs.chmodSync(base, 0o700);
  t.after(() => { chmodTree(base); fs.rmSync(base, { recursive: true, force: true }); });
  const dir = path.join(base, 'project'), def = path.join(dir, '.bowerloom');
  fs.mkdirSync(def, { recursive: true, mode: 0o755 });
  const all = {
    'harness.json': json({ format: 'bowerloom/harness/v1beta1', id: 'demo', description: 'A demo harness.', engines, parts: { ...(noDefaults ? {} : DEFAULT_PARTS), ...parts }, skills }),
    ...(noDefaults ? {} : {
      'instructions/AGENTS.md': INSTRUCTIONS,
      'skills/review/SKILL.md': skill('review', 'license: MIT\n'),
      'skills/review/references/notes.md': 'Review notes.\n',
    }),
    ...files,
  };
  for (const [rel, text] of Object.entries(all)) {
    if (text === null) continue;
    const at = path.join(def, rel); fs.mkdirSync(path.dirname(at), { recursive: true }); fs.writeFileSync(at, text, { mode: 0o644 });
  }
  const stateDir = path.join(base, 'state', 'portable');
  // Beta.1: OpenCode, Pi, and DeepSeek Harness are preview engines. These tests install to them, so the switch is on unless a test turns it off.
  const input = (extra = {}) => ({ projectDir: dir, definitionFolder: def, stateDir, previewEngines: true, ...extra });
  return { base, dir, def, stateDir, input };
}

/** Every file and folder of the project outside `.bowerloom`, with its hash and mode. A link shows its target. */
export function snapshot(dir) {
  const out = {};
  const walk = rel => {
    for (const name of fs.readdirSync(path.join(dir, rel)).sort()) {
      const r = rel ? `${rel}/${name}` : name;
      if (r === '.bowerloom') continue;
      const st = fs.lstatSync(path.join(dir, r));
      if (st.isSymbolicLink()) out[r] = `-> ${fs.readlinkSync(path.join(dir, r))}`;
      else if (st.isDirectory()) { out[r + '/'] = st.mode & 0o777; walk(r); } else out[r] = `${sha(fs.readFileSync(path.join(dir, r)))} ${(st.mode & 0o777).toString(8)}`;
    }
  };
  walk(''); return out;
}
export const stamp = file => { const s = fs.statSync(file, { bigint: true }); return `${s.ino}:${s.mtimeNs}:${s.ctimeNs}`; };
export const written = (before, after) => [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(k => before[k] !== after[k]).sort();
export async function projectNow(input) { const plan = planPortable(input); return { plan, result: await applyPortable(input, plan.revision) }; }

/** Rewrites a state record with `change(record)` and a matching revision, as a forger with file access could. */
export function forge(stateDir, name, change) {
  const file = path.join(stateDir, name);
  const record = JSON.parse(fs.readFileSync(file, 'utf8'));
  change(record);
  if (name === 'receipt.json') { const { revision: _r, ...body } = record; record.revision = sha(canonicalJson(body)); }
  fs.writeFileSync(file, JSON.stringify(record, null, 2) + '\n'); fs.chmodSync(file, 0o600);
  return record;
}
/** A crash at the n-th call of a hook. */
export const crashAt = n => { let calls = 0; const crash = Object.assign(new Error('simulated crash'), { crash: true }); return { crash, hook: () => { if (++calls === n) throw crash; } }; };
export const isCaseSensitive = base => { const a = path.join(base, 'CaseProbe'); fs.writeFileSync(a, ''); const sensitive = !fs.existsSync(path.join(base, 'caseprobe')); fs.rmSync(a); return sensitive; };
export { assert };
