// A reader over a plain object, for the pure tests. Not a test file.
import { SliceTreeError } from '../../../dist/packages/context-slices/src/resolve.js';
import { SLICE_FORMAT } from '../../../dist/packages/context-slices/src/slice-file.js';

/** `def({ include: [...] })` fills the defaults of a parsed slice. */
export const def = (extra = {}) => ({ format: SLICE_FORMAT, description: 'd', root: { kind: 'project', path: '.' }, include: ['**/*.md'], exclude: [], where: {}, links: null, summary: { kind: 'heading' }, maxFiles: 256, guard: 'root', ...extra });

/**
 * spec: path -> text | Buffer | { text, nlink, safe, type, size } . A folder is made from the paths below it. A key that ends
 * in '/' sets the folder's flags. `listed` records every folder the reader was asked to list; `reads` every file read.
 */
export function tree(spec, hooks = {}) {
  const files = new Map(), dirs = new Map([['', { safe: true }]]);
  for (const [key, value] of Object.entries(spec)) {
    if (key.endsWith('/')) { dirs.set(key.slice(0, -1), { safe: true, ...(value ?? {}) }); continue; }
    const v = typeof value === 'string' || Buffer.isBuffer(value) ? { data: Buffer.from(value) } : { data: Buffer.from(value.text ?? ''), ...value };
    files.set(key, { type: v.type ?? 'file', nlink: v.nlink ?? 1, safe: v.safe ?? true, size: v.size ?? v.data.length, data: v.data });
    const parts = key.split('/'); for (let i = 1; i < parts.length; i++) { const d = parts.slice(0, i).join('/'); if (!dirs.has(d)) dirs.set(d, { safe: true }); }
  }
  const listed = [], reads = [];
  const children = dir => {
    const prefix = dir === '' ? '' : dir + '/', out = new Set();
    for (const p of [...files.keys(), ...dirs.keys()]) if (p !== '' && p.startsWith(prefix) && !p.slice(prefix.length).includes('/') && p !== dir) out.add(p.slice(prefix.length));
    return [...out];
  };
  return {
    listed, reads,
    list(dir) { listed.push(dir); const names = hooks.names?.(dir) ?? children(dir); if (names.length > 1024) throw new SliceTreeError('SLICE_TOO_LARGE', dir); return names; },
    stat(path) {
      if (files.has(path)) { const f = files.get(path); return { type: f.type, size: f.size, nlink: f.nlink, safe: f.safe }; }
      if (dirs.has(path)) return { type: dirs.get(path).type ?? 'dir', size: 0, nlink: 1, safe: dirs.get(path).safe };
      return null;
    },
    read(path) { reads.push(path); return files.get(path).data; },
    close() { hooks.close?.(); },
  };
}
