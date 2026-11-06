// The script that builds the made-up home for the acceptance journeys (tools/made-up-home.ts): what it makes, that a second run changes nothing, that a reset returns the start state, and that it leaves other folders alone.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { join } from 'node:path';
import { MARKER, WIKI_DAYS, buildMadeUpHome, digestTree, homeFiles, removeMadeUpHome, resetMadeUpHome } from '../tools/made-up-home.js';
import { DESKTOP, tempDir } from './support.js';

// A plain copy of git, as the e2e specs look for it (never the macOS installer shim). The history tests skip when there is none.
const GIT = ['/Library/Developer/CommandLineTools/usr/bin/git', '/Applications/Xcode.app/Contents/Developer/usr/bin/git', '/usr/local/bin/git', '/opt/homebrew/bin/git', '/bin/git'].find(p => existsSync(p)) ?? null;
const git = (dir: string, args: string[]): string => {
  const r = spawnSync(GIT!, ['-C', dir, ...args], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
};
const walk = (dir: string, rel = ''): string[] => readdirSync(join(dir, rel), { withFileTypes: true }).flatMap(e => {
  const r = rel === '' ? e.name : `${rel}/${e.name}`;
  return e.isDirectory() ? (e.name === '.git' ? [] : walk(dir, r)) : [r];
});

test('it makes the folders and files of the list, with the exact text, a private home, and the marker', t => {
  const root = tempDir(t);
  const built = buildMadeUpHome(root);
  assert.equal(built.home, join(root, 'home'));
  assert.ok(existsSync(join(root, MARKER)));
  assert.equal(statSync(built.home).mode & 0o777, 0o700);
  const files = homeFiles();
  assert.deepEqual(walk(built.home).sort(), Object.keys(files).sort());
  for (const [rel, text] of Object.entries(files)) assert.equal(readFileSync(join(built.home, rel), 'utf8'), text, rel);
  assert.equal(built.wikiHasHistory, false);
  assert.equal(existsSync(join(built.wiki, '.git')), false);
});

test('it holds what the journeys need: Claude Code and Codex files at home and in projects, two or three projects, hooks, tools and one notes folder', t => {
  const names = Object.keys(homeFiles());
  const has = (re: RegExp): string[] => names.filter(n => re.test(n));
  assert.ok(has(/^\.claude\/skills\/[^/]+\/SKILL\.md$/).length >= 2);
  assert.ok(has(/^\.claude\/agents\/[^/]+\.md$/).length >= 1);
  assert.ok(has(/^\.codex\/skills\/[^/]+\/SKILL\.md$/).length >= 1);
  assert.ok(has(/^\.codex\/agents\/[^/]+\.toml$/).length >= 1);
  assert.deepEqual(has(/^Projects\/[^/]+\/CLAUDE\.md$/).length, 2);
  assert.deepEqual(has(/^Projects\/[^/]+\/AGENTS\.md$/).length, 1);
  assert.equal(new Set(names.filter(n => n.startsWith('Projects/')).map(n => n.split('/')[1])).size, 3);
  const files = homeFiles();
  assert.match(files['Projects/ferry-schedule/.claude/settings.json']!, /"hooks"/);
  assert.match(files['Projects/ferry-schedule/.mcp.json']!, /"mcpServers"/);
  assert.match(files['Projects/ferry-schedule/.codex/config.toml']!, /^model = /m);
  assert.match(files['.codex/config.toml']!, /\[mcp_servers\.tide-feed\]/);
  // The same skill in two programs, with two different texts, so the adopt step has a copy to pick.
  assert.notEqual(files['.claude/skills/chart-check/SKILL.md'], files['.codex/skills/chart-check/SKILL.md']);
  // Exactly one notes folder, with pages, and a hidden folder and a file that is not a page.
  assert.ok(has(/^Documents\/tide-notes\/.+\.md$/).length >= 5);
  assert.ok(has(/^Documents\/tide-notes\/\.obsidian\//).length >= 1);
  assert.ok(has(/^Documents\/tide-notes\/.+\.png$/).length >= 1);
  assert.equal(new Set(names.filter(n => n.startsWith('Documents/')).map(n => n.split('/')[1])).size, 1);
  t.diagnostic(`${names.length} files`);
});

test('it holds no real name, no real path, no key value and no link to a real place', () => {
  const real = [homedir(), userInfo().username].filter(s => s.length >= 4);
  for (const [rel, text] of Object.entries(homeFiles())) {
    for (const word of real) assert.ok(!text.includes(word) && !rel.includes(word), `${rel} names ${word.length} characters of the machine`);
    assert.doesNotMatch(text, /(?:^|[\s"'=(])\/(?:Users|home|private|var|tmp|Volumes)\//, `${rel}: an absolute path`);
    assert.doesNotMatch(text, /https?:\/\//, `${rel}: a link`);
    assert.doesNotMatch(text, /(?:sk-|ghp_|xox[bp]-|AKIA)[A-Za-z0-9]{8,}/, `${rel}: a key shape`);
    // A tool names the variable that holds its key; the value is never in the file.
    for (const m of text.matchAll(/"[A-Z][A-Z0-9_]*_KEY"\s*:\s*"([^"]*)"/g)) assert.match(m[1]!, /^\$\{[A-Z][A-Z0-9_]*\}$/, `${rel}: a key value`);
  }
});

test('a second build on the same folder changes nothing, and a build is a reset: an edit, an added file and a removed file all go back', t => {
  const root = tempDir(t);
  const built = buildMadeUpHome(root);
  const start = digestTree(root);
  assert.equal(digestTree(root), start, 'reading changes nothing');
  assert.equal(digestTree(buildMadeUpHome(root).root), start, 'a second build gives the same tree');
  writeFileSync(join(built.ferry, 'AGENTS.md'), 'changed\n');
  writeFileSync(join(built.home, 'extra.txt'), 'extra\n');
  rmSync(join(built.kite, 'CLAUDE.md'));
  mkdirSync(join(built.rope, '.claude'), { recursive: true });
  assert.notEqual(digestTree(root), start);
  const again = resetMadeUpHome(root);
  assert.equal(digestTree(again.root), start, 'the reset returns the start state');
  assert.equal(existsSync(join(built.home, 'extra.txt')), false);
  assert.equal(existsSync(join(built.rope, '.claude')), false);
});

test('it leaves a folder alone that it did not make, a relative path, and the root of the disk; remove works only on its own folder', t => {
  const other = tempDir(t);
  writeFileSync(join(other, 'mine.txt'), 'keep me\n');
  assert.throws(() => buildMadeUpHome(other), /did not make/);
  assert.equal(readFileSync(join(other, 'mine.txt'), 'utf8'), 'keep me\n');
  assert.equal(removeMadeUpHome(other), false);
  assert.ok(existsSync(join(other, 'mine.txt')));
  assert.throws(() => buildMadeUpHome('relative/folder'), /absolute/);
  assert.throws(() => buildMadeUpHome('/'), /not a place/);
  assert.throws(() => buildMadeUpHome(homedir()), /not a place/);
  const root = tempDir(t);
  buildMadeUpHome(root);
  assert.equal(removeMadeUpHome(root), true);
  assert.equal(existsSync(root), false);
});

test('with a git program, the wiki gets three commits on fixed days, a clean tree, and the same last commit on every build', { skip: GIT === null ? 'git is not installed where the tests look for it' : false }, t => {
  const root = tempDir(t);
  const built = buildMadeUpHome(root, { git: GIT });
  assert.equal(built.wikiHasHistory, true);
  assert.equal(git(built.wiki, ['rev-list', '--count', 'HEAD']).trim(), '3');
  assert.equal(git(built.wiki, ['status', '--porcelain']), '');
  const days = git(built.wiki, ['log', '--format=%cs']).trim().split('\n');
  assert.deepEqual(days, [...WIKI_DAYS].reverse());
  assert.deepEqual(git(built.wiki, ['log', '--format=%s']).trim().split('\n'), ['Log the pages', 'Add tide pages', 'Start the notes']);
  // The folder on disk is the file list, and the last commit holds all of it.
  const files = homeFiles();
  const wikiFiles = Object.keys(files).filter(f => f.startsWith('Documents/tide-notes/')).map(f => f.slice('Documents/tide-notes/'.length)).sort();
  assert.deepEqual(git(built.wiki, ['ls-files']).trim().split('\n').sort(), wikiFiles);
  const head = git(built.wiki, ['rev-parse', 'HEAD']);
  const digest = digestTree(root);
  writeFileSync(join(built.wiki, 'pages', 'neap-tides.md'), 'edited\n');
  const again = resetMadeUpHome(root, { git: GIT });
  assert.equal(git(again.wiki, ['rev-parse', 'HEAD']), head, 'the same commit every time');
  assert.equal(digestTree(root), digest);
  assert.equal(git(again.wiki, ['status', '--porcelain']), '');
});

test('from a terminal it prints the home folder, builds in the folder it is given, and resets it on a second run', t => {
  const root = tempDir(t);
  const script = join(DESKTOP, 'tools', 'made-up-home.ts');
  const run = (): string => {
    const r = spawnSync(process.execPath, [script, root], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '', NODE_NO_WARNINGS: '1' } });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  assert.equal(run(), join(root, 'home'));
  const start = digestTree(root);
  writeFileSync(join(root, 'home', 'Projects', 'rope-yard', 'extra.txt'), 'x\n');
  assert.equal(run(), join(root, 'home'));
  assert.equal(digestTree(root), start);
});
