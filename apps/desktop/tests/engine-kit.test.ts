// The ready-made notes keeper kit, as main loads it (main/kit.ts): read-only, from the repository in development and from the app's resources in a
// packaged build, validated at load through the harness definition loader. A broken kit is refused with words; there is never an empty kit.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { KIT_IDS, KIT_MAIN_WORDS, KIT_MARKETPLACE } from '../shared/engine/types.js';
import { kitsFolder, loadKit } from '../main/kit.js';
import { DESKTOP, tempDir } from './support.js';

const KITS = join(DESKTOP, '..', '..', 'kits');
const SKILLS = ['add-source', 'answer-from-notes', 'check-notes', 'file-page', 'log-change', 'refine-report'];
const STARTER = ['AGENTS.md', 'index.md', 'log.md', 'pages/README.md', 'reports/README.md', 'sources/README.md'];

/** A copy of the shipped kits folder, to break. */
function copyKits(t: Parameters<typeof tempDir>[0]): string {
  const dir = join(tempDir(t, 'bowerloom-kit-'), 'kits');
  cpSync(KITS, dir, { recursive: true });
  return dir;
}
const refusedWith = (run: () => unknown, words: RegExp): void => {
  assert.throws(run, (e: unknown) => {
    const err = e as { code?: string; message?: string };
    assert.equal(err.code, 'KIT_INVALID');
    assert.match(String(err.message), words);
    assert.ok(String(err.message).startsWith(KIT_MAIN_WORDS.KIT_INVALID.slice(0, 40)), String(err.message));
    return true;
  });
};

test('the shipped kit loads: its pinned version, one agent, six skills, and the starter template, every byte read from the kit folder', () => {
  assert.deepEqual([...KIT_IDS], ['wiki-keeper']);
  assert.equal(KIT_MARKETPLACE, 'bowerloom-kits');
  const kit = loadKit(KITS, 'wiki-keeper');
  const json = JSON.parse(readFileSync(join(KITS, 'wiki-keeper', 'kit.json'), 'utf8')) as { version: string; name: string };
  assert.equal(kit.id, 'wiki-keeper');
  assert.equal(kit.version, json.version);
  assert.equal(kit.name, json.name);
  assert.equal(kit.agent.id, 'notes-keeper');
  assert.equal(kit.agent.text, readFileSync(join(KITS, 'wiki-keeper', 'agents', 'notes-keeper.md'), 'utf8'));
  assert.deepEqual(kit.skills.map(s => s.id), SKILLS);
  for (const s of kit.skills) {
    assert.deepEqual(s.files.map(f => f.path), ['SKILL.md']);
    assert.ok(Buffer.from(s.files[0]!.bytes).equals(readFileSync(join(KITS, 'wiki-keeper', 'skills', s.id, 'SKILL.md'))), s.id);
  }
  assert.deepEqual(kit.starter.map(f => f.path), STARTER);
  assert.ok(Object.isFrozen(kit) && Object.isFrozen(kit.skills) && Object.isFrozen(kit.starter), 'the loaded kit is read-only');
});

test('the kit folder: the repository in development, the app resources in a packaged build, and package.json ships it as the only extra resource', () => {
  assert.equal(kitsFolder({ packaged: true, resourcesPath: '/Applications/Bowerloom.app/Contents/Resources', appRoot: '/x/dist' }), '/Applications/Bowerloom.app/Contents/Resources/kits');
  assert.equal(kitsFolder({ packaged: false, resourcesPath: '/unused', appRoot: join(DESKTOP, 'dist') }), KITS);
  const pkg = JSON.parse(readFileSync(join(DESKTOP, 'package.json'), 'utf8')) as { build: { extraResources: { from: string; to: string }[] } };
  assert.deepEqual(pkg.build.extraResources, [{ from: '../../kits', to: 'kits' }]);
});

test('a missing kit, a missing kit.json, and a kit.json that is not strict are refused with words, never an empty kit', t => {
  const kits = copyKits(t);
  refusedWith(() => loadKit(join(kits, 'nowhere'), 'wiki-keeper'), /kit folder/);
  writeFileSync(join(kits, 'wiki-keeper', 'kit.json'), '{"format": "bowerloom/kit/v1beta1", "format": "x"}');
  refusedWith(() => loadKit(kits, 'wiki-keeper'), /kit\.json/);
  rmSync(join(kits, 'wiki-keeper', 'kit.json'));
  refusedWith(() => loadKit(kits, 'wiki-keeper'), /kit\.json/);
});

test('kit.json must name its format, this kit, a pinned version, and nothing else', t => {
  const base = JSON.parse(readFileSync(join(KITS, 'wiki-keeper', 'kit.json'), 'utf8')) as Record<string, unknown>;
  for (const bad of [{ ...base, format: 'bowerloom/kit/v2' }, { ...base, id: 'other-kit' }, { ...base, version: '^0.1.0' }, { ...base, version: 'latest' }, { ...base, extra: true }, { ...base, name: '' }]) {
    const kits = copyKits(t);
    writeFileSync(join(kits, 'wiki-keeper', 'kit.json'), JSON.stringify(bad));
    refusedWith(() => loadKit(kits, 'wiki-keeper'), /kit\.json/);
  }
});

test('a skill or agent that does not load, a second agent, an agent that names a skill the kit lacks, and a secret are refused', t => {
  let kits = copyKits(t);
  writeFileSync(join(kits, 'wiki-keeper', 'skills', 'add-source', 'SKILL.md'), 'no frontmatter\n');
  refusedWith(() => loadKit(kits, 'wiki-keeper'), /does not load/);
  kits = copyKits(t);
  writeFileSync(join(kits, 'wiki-keeper', 'agents', 'second.md'), '---\nname: second\ndescription: A second agent.\n---\n\nHello.\n');
  refusedWith(() => loadKit(kits, 'wiki-keeper'), /one agent/);
  kits = copyKits(t);
  rmSync(join(kits, 'wiki-keeper', 'skills', 'log-change'), { recursive: true });
  refusedWith(() => loadKit(kits, 'wiki-keeper'), /skills/);
  kits = copyKits(t);
  const secret = 'AK' + 'IA' + 'ABCD2345'.repeat(2);
  writeFileSync(join(kits, 'wiki-keeper', 'skills', 'file-page', 'SKILL.md'), `---\nname: file-page\ndescription: Files a page.\n---\n\nKey ${secret}\n`);
  refusedWith(() => loadKit(kits, 'wiki-keeper'), /does not load/);
});

test('a link anywhere in the kit, a starter with no AGENTS.md, and a hidden starter file are refused', t => {
  let kits = copyKits(t);
  symlinkSync('/etc/hosts', join(kits, 'wiki-keeper', 'skills', 'add-source', 'hosts.md'));
  refusedWith(() => loadKit(kits, 'wiki-keeper'), /link/);
  kits = copyKits(t);
  rmSync(join(kits, 'wiki-keeper', 'starter', 'AGENTS.md'));
  refusedWith(() => loadKit(kits, 'wiki-keeper'), /starter/);
  kits = copyKits(t);
  writeFileSync(join(kits, 'wiki-keeper', 'starter', '.hidden'), 'x');
  refusedWith(() => loadKit(kits, 'wiki-keeper'), /starter/);
  kits = copyKits(t);
  rmSync(join(kits, 'wiki-keeper'), { recursive: true }); mkdirSync(join(kits, 'wiki-keeper'));
  symlinkSync(KITS, join(kits, 'wiki-keeper', 'skills'));
  refusedWith(() => loadKit(kits, 'wiki-keeper'), /kit/);
});

test('every refusal of the kit names no absolute path', t => {
  const kits = copyKits(t);
  writeFileSync(join(kits, 'wiki-keeper', 'skills', 'add-source', 'SKILL.md'), 'no frontmatter\n');
  try { loadKit(kits, 'wiki-keeper'); assert.fail('refused'); } catch (e) {
    assert.ok(!String((e as Error).message).includes(kits), String((e as Error).message));
    assert.ok(!String((e as Error).message).includes(DESKTOP), String((e as Error).message));
  }
});
