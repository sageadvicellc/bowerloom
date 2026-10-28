// Synthetic projects for the adoption tests. No private paths, no real rules, no real secrets.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const sha = b => createHash('sha256').update(b).digest('hex');
export const json = v => JSON.stringify(v, null, 2) + '\n';
export const code = expected => error => { if (error?.code !== expected) throw new Error(`expected ${expected}, got ${error?.code}: ${error?.message}`); return true; };
export const skill = (name, extra = '', body = `Use ${name} with care.\n`, description = 'Reviews a change before merge.') =>
  `---\nname: ${name}\ndescription: ${description}\n${extra}---\n\n${body}`;
export const agent = (name, extra = '', body = 'Read the files and report.\n') => `---\nname: ${name}\ndescription: A careful reader.\n${extra}---\n\n${body}`;
export const INSTRUCTIONS = '# Demo\n\nStanding fact: the demo uses npm.\n\n## Tool guidance\n\nSearch before you read.\n';

function chmodTree(p) { try { const st = fs.lstatSync(p); if (st.isDirectory() && !st.isSymbolicLink()) { fs.chmodSync(p, 0o700); for (const n of fs.readdirSync(p)) chmodTree(path.join(p, n)); } } catch { /* gone */ } }

/**
 * A project folder with the given files. A value is text, `{ link: target }` for a symbolic link, `{ mode, text }` for a
 * file with a mode, or null to leave the path out.
 */
export function project(t, files = {}) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bowerloom-adoption-'))); fs.chmodSync(base, 0o700);
  t.after(() => { chmodTree(base); fs.rmSync(base, { recursive: true, force: true }); });
  const dir = path.join(base, 'project');
  fs.mkdirSync(dir, { mode: 0o755 });
  write(dir, files);
  return { base, dir, def: path.join(dir, '.bowerloom'), input: (extra = {}) => ({ projectDir: dir, ...extra }) };
}
export function write(dir, files) {
  for (const [rel, value] of Object.entries(files)) {
    if (value === null) continue;
    const at = path.join(dir, rel); fs.mkdirSync(path.dirname(at), { recursive: true });
    if (typeof value === 'object' && value.link !== undefined) fs.symlinkSync(value.link, at);
    else if (typeof value === 'object') { fs.writeFileSync(at, value.text, { mode: value.mode }); fs.chmodSync(at, value.mode); }
    else fs.writeFileSync(at, value, { mode: 0o644 });
  }
}

/** Every entry of a folder with its hash and mode; a link shows its target. */
export function snapshot(dir) {
  const out = {};
  const walk = rel => {
    for (const name of fs.readdirSync(path.join(dir, rel)).sort()) {
      const r = rel ? `${rel}/${name}` : name;
      const st = fs.lstatSync(path.join(dir, r));
      if (st.isSymbolicLink()) out[r] = `-> ${fs.readlinkSync(path.join(dir, r))}`;
      else if (st.isDirectory()) { out[r + '/'] = (st.mode & 0o777).toString(8); walk(r); } else out[r] = `${sha(fs.readFileSync(path.join(dir, r)))} ${(st.mode & 0o777).toString(8)} ${st.mtimeMs}`;
    }
  };
  walk(''); return out;
}
/** The snapshot without the files adoption writes into `.bowerloom`. */
export const originals = (snap, written) => Object.fromEntries(Object.entries(snap).filter(([k]) => !written.has(k)));

export const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8');
export const item = (plan, part, id) => plan.items.find(i => i.part === part && i.id === id);
export const unmappedAt = (plan, p) => plan.unmapped.filter(u => u.path === p || u.path.startsWith(p + '/'));
