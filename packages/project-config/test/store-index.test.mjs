// Round 2 of the reviews of PR 100: the reader of the store's git index (storeTracksFolders). Each index here is built by
// hand, so the test needs no git. A version 4 index that makes each path longer than the last must finish at once.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { storeTracksFolders } from '../../../dist/packages/project-config/src/git.js';

function store(t, index) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bowerloom-index-'))); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, '.git'), { mode: 0o755 }); fs.writeFileSync(path.join(dir, '.git', 'config'), '[core]\n\trepositoryformatversion = 0\n', { mode: 0o644 });
  fs.writeFileSync(path.join(dir, '.git', 'index'), index, { mode: 0o644 });
  return dir;
}
const header = (version, count) => { const b = Buffer.alloc(12); b.write('DIRC', 0, 'latin1'); b.writeUInt32BE(version, 4); b.writeUInt32BE(count, 8); return b; };
/** A version 2 entry: 62 fixed bytes, the path, and 1 to 8 NUL bytes to a multiple of 8. */
function entry2(name) { const fixed = Buffer.alloc(62); fixed.writeUInt16BE(Math.min(name.length, 0xfff), 60); const len = (62 + name.length + 8) & ~7; return Buffer.concat([fixed, Buffer.from(name), Buffer.alloc(len - 62 - name.length)]); }
/** A version 4 entry: 62 fixed bytes, the varint of bytes to strip, the suffix, and one NUL. */
function entry4(strip, suffix) { const fixed = Buffer.alloc(62); return Buffer.concat([fixed, Buffer.from([strip]), Buffer.from(suffix), Buffer.alloc(1)]); }
const trailer = Buffer.alloc(20);

test('a version 2 index: a path under folders/ is found; folders-other and a nested folders/ are not', t => {
  assert.equal(storeTracksFolders(store(t, Buffer.concat([header(2, 2), entry2('a.md'), entry2('folders/kb.json'), trailer]))), true);
  assert.equal(storeTracksFolders(store(t, Buffer.concat([header(2, 2), entry2('folders-other/x'), entry2('skills/a/folders/x.md'), trailer]))), false);
});

test('a version 4 index: compressed paths are rebuilt from the prefix that is kept', t => {
  assert.equal(storeTracksFolders(store(t, Buffer.concat([header(4, 2), entry4(0, 'folder'), entry4(0, 's/kb.json'), trailer]))), true);
  assert.equal(storeTracksFolders(store(t, Buffer.concat([header(4, 2), entry4(0, 'foldersx'), entry4(1, '-y'), trailer]))), false);
});

test('S6. a hostile version 4 index whose paths keep growing is refused at once, as unknown', t => {
  const parts = [header(4, 200000)]; for (let i = 0; i < 200000; i++) parts.push(entry4(0, 'abcdefgh'));
  const dir = store(t, Buffer.concat([...parts, trailer]));
  const started = process.hrtime.bigint(), got = storeTracksFolders(dir), ms = Number(process.hrtime.bigint() - started) / 1e6;
  assert.equal(got, null); assert.ok(ms < 1000, `${ms} ms`);
});

test('M5 and C4. a split index (link extension), a bad signature, a short file, and an unknown version are unknown', t => {
  const link = Buffer.concat([Buffer.from('link'), Buffer.from([0, 0, 0, 20]), Buffer.alloc(20)]);
  assert.equal(storeTracksFolders(store(t, Buffer.concat([header(2, 1), entry2('a.md'), link, trailer]))), null);
  // A known extension, such as TREE, is walked past.
  const tree = Buffer.concat([Buffer.from('TREE'), Buffer.from([0, 0, 0, 3]), Buffer.from('abc')]);
  assert.equal(storeTracksFolders(store(t, Buffer.concat([header(2, 1), entry2('a.md'), tree, trailer]))), false);
  assert.equal(storeTracksFolders(store(t, Buffer.from('JUNK and more bytes'))), null);
  assert.equal(storeTracksFolders(store(t, Buffer.concat([header(2, 3), entry2('a.md')]))), null);
  assert.equal(storeTracksFolders(store(t, Buffer.concat([header(5, 0), trailer]))), null);
});
