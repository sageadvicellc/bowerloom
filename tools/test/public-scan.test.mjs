import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { scanLine, addedLines, parseTerms, checkPrBody, parseArgs, formatResult, DEFAULT_BASE, WINDOW_CHARS, WINDOW_OVERLAP, MAX_BINARY_BYTES } from '../public-scan.mjs';

const script = fileURLToPath(new URL('../public-scan.mjs', import.meta.url));
const made = [];
test.after(() => { for (const dir of made) fs.rmSync(dir, { recursive: true, force: true }); });
const tmp = () => { const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'public-scan-test-'))); made.push(dir); return dir; };

// Every fake leak is built from parts at run time, so this file holds no real-looking leak and the scanner passes on its own branch.
const USERS = '/Us' + 'ers/', HOME = '/ho' + 'me/', WIN = 'C:\\Us' + 'ers\\';
const SESSION = 'https://claude' + '.ai/code/session_' + 'abc123';
const TMP_CLAUDE = '/private' + '/tmp/claude' + '-501/x';
const LOCAL_ID = 'local' + '_' + '0b2f6c1e-1d3a-4c5b-8e7f-9a0b1c2d3e4f';
const secrets = {
  ghp: 'gh' + 'p_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8',
  pat: 'github' + '_pat_' + '11ABCDEFG0abcdefghij_klmnopqrstuvwxyz0123456789',
  npm: 'np' + 'm_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8',
  sk: 's' + 'k-' + 'abcdefghijklmnopqrstuvwxyz0123',
  aws: 'AK' + 'IA' + 'ABCDEFGHIJKLMNOP',
  pem: '-----BEGIN ' + 'RSA PRIVATE' + ' KEY-----',
  jwt: 'ey' + 'J' + 'hbGciOiJIUzI1NiJ9' + '.' + 'ey' + 'J' + 'zdWIiOiIxMjM0NTY3ODkwIn0' + '.' + 'c2lnbmF0dXJl',
  slack: 'xo' + 'xb-' + '123456789012-abcdefghijkl',
  google: 'AI' + 'za' + 'SyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q',
  authToken: '//registry.example.com/:_auth' + 'Token=' + 'a1b2c3d4e5f6',
  authBasic: '_auth' + '=' + 'dXNlcjpwYXNz',
  password: 'DB_PASS' + 'WORD=' + 'hunter2hunter2',
};
const EMAIL = 'someone' + '@' + 'corp-mail.org';
const TERM = 'Zorblaxian';
const kinds = line => scanLine(line).map(f => f.kind);

// ---- scanLine ----

test('scanLine finds home paths on macOS, Linux, and Windows', () => {
  assert.deepEqual(kinds(`cd ${USERS}jane/code`), ['home-path']);
  assert.deepEqual(kinds(`path=${HOME}jane/code`), ['home-path']);
  assert.deepEqual(kinds(`dir ${WIN}jane\\code`), ['home-path']);
  assert.deepEqual(kinds(`"${WIN.replaceAll('\\', '\\\\')}jane\\\\code"`), ['home-path']);
  assert.deepEqual(kinds(`ends at ${USERS}jane`), ['home-path']);
});

test('scanLine allows the placeholder names and anything in angle brackets', () => {
  for (const name of ['you', 'user', 'name', 'example', 'username', 'me', 'runner', 'You', 'USER', '<name>', '<your-name>', '<anything at all>']) {
    assert.deepEqual(kinds(`${USERS}${name}/x ${HOME}${name}/y ${WIN}${name}\\z`), [], name);
  }
  assert.deepEqual(kinds(`${USERS}Shared/x`), []);
  assert.deepEqual(kinds(`/home/<name>/x and $HOME and ~/x and %USERPROFILE%`), []);
});

test('scanLine does not treat its own regular-expression text as a path', () => {
  assert.deepEqual(kinds('const re = /\\/Users\\/(\\w+)\\//; // looks for /home\\/'), []);
  assert.deepEqual(kinds('src/Users/jane.ts and my/home/jane'), []);
});

test('scanLine finds session links, scratch folders, and session ids', () => {
  assert.deepEqual(kinds(`see ${SESSION}`), ['session-link']);
  assert.deepEqual(kinds(`dir ${TMP_CLAUDE}`), ['tmp-path']);
  assert.deepEqual(kinds(`dir /tmp` + `/claude-abc/y`), ['tmp-path']);
  assert.deepEqual(kinds(`id ${LOCAL_ID}`), ['session-id']);
  assert.deepEqual(kinds('local_state and local_ids are fine, so is local_1234'), []);
});

test('scanLine finds email addresses and allows the listed ones', () => {
  assert.deepEqual(kinds(`write to ${EMAIL}.`), ['email']);
  assert.deepEqual(kinds('a@example.com, 123+bot@users.noreply.github.com, noreply@anthropic.com, git@github.com:org/repo.git'), []);
  assert.deepEqual(kinds('Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>'), []);
  assert.deepEqual(kinds('npm@11.0.0 typescript@7.0.2 @types/node @scope/pkg@1.2.3 x@latest'), []);
});

test('scanLine finds likely secrets and redacts them', () => {
  for (const [name, value] of Object.entries(secrets)) {
    const found = scanLine(`token: ${value} end`);
    assert.deepEqual(found.map(f => f.kind), ['secret'], name);
    assert.equal(found[0].excerpt, '[redacted]', name);
    assert.equal(JSON.stringify(found).includes(value), false, name);
  }
});

test('scanLine does not flag a bare prefix or a short look-alike', () => {
  assert.deepEqual(kinds("startsWith('gh" + "p_') or github" + "_pat_ or npm" + "_ or s" + "k- or AK" + "IA"), []);
  assert.deepEqual(kinds('task-' + 'abcdefghijklmnopqrstuvwxyz0123 and disk-' + 'abcdefghijklmnopqrstuvwxyz'), []);
  assert.deepEqual(kinds('np' + 'm_' + 'short'), []);
});

test('scanLine reports two leaks on one line, and masks a secret that sits near a path in the excerpt', () => {
  const found = scanLine(`${USERS}jane/x ${secrets.ghp} ${EMAIL}`);
  assert.deepEqual(found.map(f => f.kind).sort(), ['email', 'home-path', 'secret']);
  assert.equal(JSON.stringify(found).includes(secrets.ghp), false);
  assert.equal(found.find(f => f.kind === 'session-id'), undefined);
});

test('scanLine never puts a session id in an excerpt', () => {
  const found = scanLine(`id ${LOCAL_ID} and ${SESSION}`);
  assert.equal(JSON.stringify(found).includes('0b2f6c1e'), false);
  assert.equal(JSON.stringify(found).includes('abc123'), false);
});

// ---- terms ----

test('parseTerms keeps one term per line, skips blanks and comments, and records the line number', () => {
  assert.deepEqual(parseTerms(`# list\n\n${TERM}\n  Two Words  \r\n#x\nlast`), [{ term: TERM, line: 3 }, { term: 'Two Words', line: 4 }, { term: 'last', line: 6 }]);
  assert.deepEqual(parseTerms(''), []);
});

test('parseTerms reads a file with CR-only (old Mac) or mixed line endings, with the same line numbers an editor shows', () => {
  assert.deepEqual(parseTerms(`# list\r${TERM}\rSecond Term\r`), [{ term: TERM, line: 2 }, { term: 'Second Term', line: 3 }]);
  assert.deepEqual(parseTerms(`one\r\ntwo\rthree\nfour`), [{ term: 'one', line: 1 }, { term: 'two', line: 2 }, { term: 'three', line: 3 }, { term: 'four', line: 4 }]);
});

test('scanLine matches a term case-insensitively as a whole word, and gives only the term-file line', () => {
  const terms = parseTerms(`other\n${TERM}\n`);
  assert.deepEqual(scanLine(`about ${TERM.toUpperCase()} here`, terms).map(f => [f.kind, f.termLine]), [['term', 2]]);
  assert.deepEqual(scanLine(`${TERM.toLowerCase()}-suffix and (${TERM})`, terms).map(f => f.kind), ['term', 'term']);
  assert.deepEqual(scanLine(`${TERM}s and pre${TERM} and ${TERM}9 and x_${TERM}9`, terms), []);
  assert.deepEqual(scanLine(`${TERM}_x and x_${TERM} and ${TERM.toLowerCase()}_`, terms).map(f => f.kind), ['term', 'term', 'term'], 'an underscore ends a word');
  const hit = scanLine(`the ${TERM} case`, terms)[0];
  assert.equal(hit.excerpt, '[redacted]');
  assert.equal(JSON.stringify(hit).toLowerCase().includes(TERM.toLowerCase()), false);
});

test('a term with regular-expression characters is matched literally', () => {
  const terms = parseTerms('a.b+c\n(x)');
  assert.equal(scanLine('has a.b+c inside', terms).length, 1);
  assert.equal(scanLine('has aXbbc inside', terms).length, 0);
  assert.equal(scanLine('call (x) now', terms).length, 1);
});

test('a term inside another finding is masked in that finding', () => {
  const terms = parseTerms(TERM);
  const found = scanLine(`write ${TERM.toLowerCase()}.team${'@'}corp-mail.org`, terms);
  assert.equal(JSON.stringify(found).toLowerCase().includes(TERM.toLowerCase()), false);
});

// ---- addedLines ----

test('addedLines reads only added lines, with their new line numbers, from a unified diff', () => {
  const diff = [
    'diff --git a/src/a.txt b/src/a.txt', 'index 111..222 100644', '--- a/src/a.txt', '+++ b/src/a.txt',
    '@@ -3,2 +3,3 @@ context', '-old line', '+new line three', '+new line four', ' kept',
    '@@ -20,0 +22,1 @@', '+tail line',
    'diff --git a/gone.txt b/gone.txt', 'deleted file mode 100644', '--- a/gone.txt', '+++ /dev/null', '@@ -1 +0,0 @@', '-bye',
    'diff --git a/img.png b/img.png', 'Binary files a/img.png and b/img.png differ',
    'diff --git a/with space.txt b/with space.txt', '--- a/with space.txt\t', '+++ b/with space.txt\t', '@@ -0,0 +1 @@', '+++plus-plus-plus text',
  ].join('\n');
  assert.deepEqual(addedLines(diff), [
    { file: 'src/a.txt', line: 3, text: 'new line three' },
    { file: 'src/a.txt', line: 4, text: 'new line four' },
    { file: 'src/a.txt', line: 22, text: 'tail line' },
    { file: 'with space.txt', line: 1, text: '++plus-plus-plus text' },
  ]);
});

// ---- PR body ----

const GOOD = '> [!NOTE]\n> Changed one thing.\n\nWhy: it is small.\n';

test('checkPrBody accepts an alert opener and 300 words or fewer', () => {
  for (const kind of ['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION']) assert.deepEqual(checkPrBody(`> [!${kind}]\n> x\n`).findings, [], kind);
  assert.deepEqual(checkPrBody(`\n\n${GOOD}`).findings, []);
  const body = '> [!NOTE]\n' + 'word '.repeat(296).trim() + '\n';
  assert.equal(checkPrBody(body).words, 298);
  assert.deepEqual(checkPrBody(body).findings, []);
});

test('checkPrBody refuses a first line that is not an alert opener, and a body over 300 words', () => {
  assert.deepEqual(checkPrBody('Plain text first\n> [!NOTE]\n').findings.map(f => f.kind), ['pr-body-alert']);
  assert.deepEqual(checkPrBody('> [!INFO]\nx').findings.map(f => f.kind), ['pr-body-alert']);
  assert.deepEqual(checkPrBody('> [!note]\nx').findings.map(f => f.kind), ['pr-body-alert']);
  assert.deepEqual(checkPrBody('').findings.map(f => f.kind), ['pr-body-alert']);
  const long = checkPrBody('> [!TIP]\n' + 'w '.repeat(300));
  assert.equal(long.words, 302);
  assert.deepEqual(long.findings.map(f => f.kind), ['pr-body-words']);
  assert.equal(checkPrBody('> [!TIP]\n' + 'w '.repeat(298)).findings.length, 0);
  assert.equal(checkPrBody('> [!TIP]\n' + 'w '.repeat(299)).findings.length, 1);
});

test('checkPrBody scans the body for leaks and terms, with line numbers', () => {
  const body = `> [!NOTE]\nok line\nsee ${SESSION}\nand ${secrets.ghp}\nand ${TERM}\n`;
  const result = checkPrBody(body, parseTerms(`x\n${TERM}`));
  assert.deepEqual(result.findings.map(f => [f.kind, f.line]), [['session-link', 3], ['secret', 4], ['term', 5]]);
  assert.equal(result.findings[2].termLine, 2);
});

test('parseArgs reads the options and rejects wrong use', () => {
  assert.deepEqual({ base: parseArgs([]).base, json: parseArgs(['--json']).json }, { base: DEFAULT_BASE, json: true });
  assert.equal(DEFAULT_BASE, 'origin/release/0.8.0-beta.2');
  assert.equal(parseArgs(['--base', 'main', '--pr-body', 'b.md', '--terms-file', '/abs/t.txt']).termsFile, '/abs/t.txt');
  assert.equal(parseArgs(['--help']).help, true);
  for (const bad of [['--base'], ['--pr-body'], ['--terms-file', 'relative.txt'], ['--bogus'], ['extra']]) assert.ok(parseArgs(bad).usage, JSON.stringify(bad));
});

// ---- Integration: the script against a real temporary repository ----

const { GIT_DIR: _d, GIT_INDEX_FILE: _i, GIT_WORK_TREE: _w, ...CLEAN_ENV } = process.env;
const CEILING = fs.realpathSync(os.tmpdir());
const GIT_ENV = { ...CLEAN_ENV, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.com' };
function git(cwd, ...args) {
  const run = spawnSync('git', args, { cwd, encoding: 'utf8', env: GIT_ENV });
  assert.equal(run.status, 0, `git ${args.join(' ')}\n${run.stderr}`);
  return run.stdout.trim();
}
/** A repository with a base branch `main` holding file a.txt, then a branch `topic` checked out. */
function repo() {
  const dir = tmp();
  git(dir, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'line one\nline two\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-qm', 'base');
  git(dir, 'checkout', '-q', '-b', 'topic');
  return dir;
}
const commit = (dir, files, message = 'topic change') => {
  for (const [name, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true }); fs.writeFileSync(path.join(dir, name), text); }
  git(dir, 'add', '.');
  git(dir, 'commit', '-qm', message);
};
function scan(dir, args = [], { json = true } = {}) {
  const run = spawnSync(process.execPath, [script, '--base', 'main', ...args, ...(json ? ['--json'] : [])], { cwd: dir, encoding: 'utf8', env: GIT_ENV });
  let out = null;
  if (json) try { out = JSON.parse(run.stdout); } catch { /* not JSON */ }
  return { status: run.status, json: out, stdout: run.stdout, stderr: run.stderr };
}

test('scan: --help exits 0 and a wrong flag exits 2', () => {
  const help = spawnSync(process.execPath, [script, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /Usage: node tools\/public-scan\.mjs/);
  assert.equal(spawnSync(process.execPath, [script, '--nope'], { encoding: 'utf8' }).status, 2);
});

test('scan: a clean branch exits 0 with one JSON object', () => {
  const dir = repo();
  commit(dir, { 'b.txt': 'nothing private here\n', 'c.txt': `placeholder ${USERS}you/x and a@example.com\n` });
  const run = scan(dir);
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.equal(run.json.ok, true);
  assert.deepEqual(run.json.findings, []);
  assert.equal(run.json.commits, 1);
  assert.equal(run.json.files, 2);
  assert.equal(run.json.addedLines, 2);
  assert.equal(run.json.base, 'main');
  assert.equal(run.stdout.trim().split('\n').length, 1);
});

test('scan: finds every planted leak in added lines, with the right file and line', () => {
  const dir = repo();
  const lines = ['fine', `home ${USERS}jane/x`, `link ${SESSION}`, `key ${secrets.ghp}`, `mail ${EMAIL}`, `scratch ${TMP_CLAUDE}`, `id ${LOCAL_ID}`];
  commit(dir, { 'src/leaky.txt': lines.join('\n') + '\n' });
  const run = scan(dir);
  assert.equal(run.status, 1);
  assert.equal(run.json.ok, false);
  assert.deepEqual(run.json.findings.map(f => [f.kind, f.file, f.line]), [['home-path', 'src/leaky.txt', 2], ['session-link', 'src/leaky.txt', 3], ['secret', 'src/leaky.txt', 4], ['email', 'src/leaky.txt', 5], ['tmp-path', 'src/leaky.txt', 6], ['session-id', 'src/leaky.txt', 7]]);
  assert.equal(run.stdout.includes(secrets.ghp), false, 'the secret is never printed');
  assert.equal(run.stdout.includes('0b2f6c1e'), false, 'the session id is never printed');
  assert.equal(run.json.counts['home-path'], 1);
});

test('scan: leaks that the base already holds, or that the branch removed, are not reported', () => {
  const dir = tmp();
  git(dir, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(dir, 'old.txt'), `old ${USERS}jane/x\nremove me ${EMAIL}\nkeep\n`);
  git(dir, 'add', '.'); git(dir, 'commit', '-qm', 'base');
  git(dir, 'checkout', '-q', '-b', 'topic');
  fs.writeFileSync(path.join(dir, 'old.txt'), `old ${USERS}jane/x\nkeep\nadded clean line\n`);
  git(dir, 'add', '.'); git(dir, 'commit', '-qm', 'trim');
  const run = scan(dir);
  assert.equal(run.status, 0, run.stdout);
  assert.deepEqual(run.json.findings, []);
});

test('scan: a leak in a commit message is found, with the commit as the file', () => {
  const dir = repo();
  commit(dir, { 'b.txt': 'clean\n' }, `Fix the thing\n\nSee ${SESSION}\n`);
  const run = scan(dir);
  assert.equal(run.status, 1);
  assert.equal(run.json.findings.length, 1);
  assert.equal(run.json.findings[0].kind, 'session-link');
  assert.match(run.json.findings[0].file, /^commit:[0-9a-f]{7}$/);
  assert.equal(run.json.findings[0].line, 3);
});

test('scan: the allowed trailer in a commit message passes', () => {
  const dir = repo();
  commit(dir, { 'b.txt': 'clean\n' }, 'Change\n\nCo-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>');
  assert.equal(scan(dir).status, 0);
});

test('scan: a commit author or committer address that is not on the allowed list is found', () => {
  const dir = repo();
  fs.writeFileSync(path.join(dir, 'b.txt'), 'clean\n');
  git(dir, 'add', '.');
  const run = spawnSync('git', ['commit', '-qm', 'by a person'], { cwd: dir, encoding: 'utf8', env: { ...GIT_ENV, GIT_AUTHOR_EMAIL: EMAIL } });
  assert.equal(run.status, 0, run.stderr);
  const result = scan(dir);
  assert.equal(result.status, 1);
  assert.deepEqual(result.json.findings.map(f => f.kind), ['email']);
  assert.match(result.json.findings[0].file, /^commit:/);
});

test('scan: an unknown base exits 2', () => {
  const dir = repo();
  const run = spawnSync(process.execPath, [script, '--base', 'no-such-ref', '--json'], { cwd: dir, encoding: 'utf8', env: GIT_ENV });
  assert.equal(run.status, 2);
  assert.match(run.stderr, /base/);
});

test('scan: outside a git repository exits 2', () => {
  const run = spawnSync(process.execPath, [script, '--json'], { cwd: tmp(), encoding: 'utf8', env: { ...GIT_ENV, GIT_CEILING_DIRECTORIES: CEILING } });
  assert.equal(run.status, 2);
});

test('scan: --terms-file finds a private term, reports the term-file line, and never prints the term', () => {
  const dir = repo();
  const elsewhere = tmp();
  const terms = path.join(elsewhere, 'terms.txt');
  fs.writeFileSync(terms, `# private terms\nunrelated\n${TERM}\n`);
  commit(dir, { 'notes/n.md': `fine\nabout the ${TERM.toLowerCase()} client\n` }, `mention ${TERM} in a message`);
  fs.writeFileSync(path.join(dir, 'body.md'), `> [!NOTE]\nfor ${TERM}\n`);
  for (const json of [true, false]) {
    const run = scan(dir, ['--terms-file', terms, '--pr-body', path.join(dir, 'body.md')], { json });
    assert.equal(run.status, 1);
    assert.equal((run.stdout + run.stderr).toLowerCase().includes(TERM.toLowerCase()), false, `no term in output (json=${json})`);
    if (json) {
      const hits = run.json.findings.filter(f => f.kind === 'term');
      assert.deepEqual(hits.map(f => [f.file.replace(/^commit:.*/, 'commit'), f.line, f.termLine]), [['notes/n.md', 2, 3], ['commit', 1, 3], ['pr-body', 2, 3]]);
      assert.equal(run.json.termsChecked, 2);
    }
  }
});

test('scan: --terms-file inside the repository is refused, and so are a relative or missing one', () => {
  const dir = repo();
  fs.writeFileSync(path.join(dir, 'terms.txt'), TERM);
  const inside = scan(dir, ['--terms-file', path.join(dir, 'terms.txt')]);
  assert.equal(inside.status, 2);
  assert.match(inside.stderr, /outside the repository/);
  assert.equal(inside.stderr.includes(TERM), false);
  fs.mkdirSync(path.join(dir, 'sub'));
  assert.equal(scan(dir, ['--terms-file', path.join(dir, 'sub', '..', 'terms.txt')]).status, 2);
  assert.equal(scan(dir, ['--terms-file', path.join(tmp(), 'absent.txt')]).status, 2);
  assert.equal(spawnSync(process.execPath, [script, '--terms-file', 'rel.txt'], { cwd: dir, encoding: 'utf8' }).status, 2);
});

test('scan: a terms file reached through a symlink into the repository is refused', () => {
  const dir = repo();
  fs.writeFileSync(path.join(dir, 'terms.txt'), TERM);
  const elsewhere = tmp();
  fs.symlinkSync(path.join(dir, 'terms.txt'), path.join(elsewhere, 'link.txt'));
  assert.equal(scan(dir, ['--terms-file', path.join(elsewhere, 'link.txt')]).status, 2);
});

test('scan: --pr-body passes a good body and fails a bad shape, a long body, and a leak in the body', () => {
  const dir = repo();
  commit(dir, { 'b.txt': 'clean\n' });
  const body = name => path.join(tmp(), name);
  const write = (text) => { const file = body('pr.md'); fs.writeFileSync(file, text); return file; };
  const good = scan(dir, ['--pr-body', write(GOOD)]);
  assert.equal(good.status, 0, good.stdout);
  assert.equal(good.json.prBody.words, 10);
  const shape = scan(dir, ['--pr-body', write('Summary first\n')]);
  assert.equal(shape.status, 1);
  assert.deepEqual(shape.json.findings.map(f => f.kind), ['pr-body-alert']);
  const long = scan(dir, ['--pr-body', write('> [!NOTE]\n' + 'w '.repeat(400))]);
  assert.deepEqual(long.json.findings.map(f => f.kind), ['pr-body-words']);
  const leak = scan(dir, ['--pr-body', write(`> [!NOTE]\nsee ${SESSION}\n`)]);
  assert.deepEqual(leak.json.findings.map(f => [f.kind, f.file, f.line]), [['session-link', 'pr-body', 2]]);
  assert.equal(scan(dir, ['--pr-body', body('absent.md')]).status, 2);
});

test('scan: the human output names the first finding and stays short', () => {
  const dir = repo();
  commit(dir, { 'many.txt': Array.from({ length: 60 }, (_, i) => `row ${i} ${USERS}jane${i}/x`).join('\n') + '\n' });
  const run = scan(dir, [], { json: false });
  assert.equal(run.status, 1);
  assert.match(run.stdout, /many\.txt:1/);
  assert.match(run.stdout, /60 findings/);
  assert.ok(run.stdout.split('\n').length <= 30);
});

test('scan: the JSON lists at most 200 findings and says when it cut the list', () => {
  const dir = repo();
  commit(dir, { 'many.txt': Array.from({ length: 250 }, (_, i) => `row ${i} ${USERS}jane${i}/x`).join('\n') + '\n' });
  const run = scan(dir);
  assert.equal(run.json.findings.length, 200);
  assert.equal(run.json.truncated, true);
  assert.equal(run.json.counts['home-path'], 250);
});

test('scan: a deleted file adds no lines, and a clean binary file is scanned from the HEAD blob and listed as binaryScanned', () => {
  const dir = repo();
  fs.writeFileSync(path.join(dir, 'blob.bin'), Buffer.from([0, 1, 2, 3, 0, 255]));
  fs.rmSync(path.join(dir, 'a.txt'));
  git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'binary and delete');
  const run = scan(dir);
  assert.equal(run.status, 0, run.stdout);
  assert.equal(run.json.addedLines, 0);
  assert.equal(run.json.binaryFiles, 1);
  assert.deepEqual(run.json.binaryScanned, ['blob.bin']);
  assert.deepEqual(run.json.unscanned, []);
  assert.equal(run.json.empty, false, 'a scanned binary file is something to scan');
  assert.match(scan(dir, [], { json: false }).stdout, /binary: 1 file scanned from its HEAD blob: blob\.bin/);
});

test('scan: a leak inside a binary file is found, and its file is named only by the binary path, never the secret', () => {
  const dir = repo();
  const bytes = Buffer.concat([Buffer.from([0, 1, 2, 3, 0xff, 0xfe]), Buffer.from(` key=${secrets.ghp} mail ${EMAIL} `, 'latin1'), Buffer.from([0, 9, 0, 0x80, 0x81])]);
  commit(dir, { 'assets/icon.png': bytes, 'ok.txt': 'fine\n' });
  const run = scan(dir);
  assert.equal(run.status, 1);
  assert.deepEqual(run.json.findings.map(f => [f.kind, f.file, f.line]).sort(), [['email', 'assets/icon.png', 0], ['secret', 'assets/icon.png', 0]]);
  assert.deepEqual(run.json.binaryScanned, ['assets/icon.png']);
  assert.equal(run.stdout.includes(secrets.ghp), false);
  assert.equal(run.stdout.includes('corp-mail'), false);
});

test('scan: a binary file whose own name holds a leak is listed with the name withheld', () => {
  const dir = repo();
  commit(dir, { [`logos/${EMAIL}.bin`]: Buffer.from([0, 1, 2, 0]) });
  const run = scan(dir);
  assert.equal(run.status, 1);
  assert.equal(run.stdout.includes('corp-mail'), false);
  assert.equal(run.json.binaryScanned.length, 1);
  assert.match(run.json.binaryScanned[0], /withheld/);
});

test('scan: a binary file over the size cap is unscanned and makes the exit 1; a deleted binary file is not scanned', () => {
  assert.equal(MAX_BINARY_BYTES, 5 * 1024 * 1024);
  const dir = tmp();
  git(dir, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(dir, 'gone.bin'), Buffer.from([0, 1, 2]));
  git(dir, 'add', '.'); git(dir, 'commit', '-qm', 'base');
  git(dir, 'checkout', '-q', '-b', 'topic');
  fs.rmSync(path.join(dir, 'gone.bin'));
  fs.writeFileSync(path.join(dir, 'huge.bin'), Buffer.alloc(MAX_BINARY_BYTES + 1, 0));
  fs.writeFileSync(path.join(dir, 'text.txt'), 'fine\n');
  git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'big');
  const run = scan(dir);
  assert.equal(run.status, 1, run.stdout);
  assert.equal(run.json.ok, false);
  assert.deepEqual(run.json.findings, []);
  assert.deepEqual(run.json.unscanned.map(u => u.file), ['huge.bin']);
  assert.match(run.json.unscanned[0].reason, /5 MiB/);
  assert.deepEqual(run.json.binaryScanned, []);
  const human = scan(dir, [], { json: false });
  assert.equal(human.status, 1);
  assert.match(human.stdout, /NOT CLEAN.*unscanned.*huge\.bin/s);
});

test('scan: a secret added in one commit and removed in a later one is found in the commit patch', () => {
  const dir = repo();
  commit(dir, { 'conf.txt': `ok\nkey ${secrets.ghp}\nmore\n` }, 'add config');
  const added = git(dir, 'rev-parse', '--short=7', 'HEAD');
  commit(dir, { 'conf.txt': 'ok\nmore\n' }, 'remove the key again');
  const run = scan(dir);
  assert.equal(run.status, 1, run.stdout);
  assert.deepEqual(run.json.findings.map(f => [f.kind, f.file, f.line, f.commit]), [['secret', 'conf.txt', 2, added]]);
  assert.equal(run.json.addedLines, 2, 'the net diff holds the two lines that stayed');
  assert.equal(run.json.patchLines, 3, 'the patches hold the third, removed one');
  assert.equal(run.stdout.includes(secrets.ghp), false);
  assert.match(scan(dir, [], { json: false }).stdout, new RegExp(`secret conf\\.txt:2 \\[redacted\\].*commit ${added}`));
});

test('scan: a leak that stays in the final tree is reported once, not once per commit', () => {
  const dir = repo();
  commit(dir, { 'conf.txt': `key ${secrets.ghp}\n` }, 'add');
  commit(dir, { 'other.txt': 'x\n' }, 'more');
  const run = scan(dir);
  assert.deepEqual(run.json.findings.map(f => [f.kind, f.file, f.line]), [['secret', 'conf.txt', 1]]);
  assert.equal(run.json.findings[0].commit, undefined, 'a net-diff finding carries no commit');
});

test('scan: a leak in a commit message after a record-separator or unit-separator character is still found', () => {
  const dir = repo();
  commit(dir, { 'b.txt': 'clean\n' }, `Change\n\nfirst\x1e second ${SESSION}\nthird\x1f ${LOCAL_ID}\nlast ${TERM}\n`);
  const terms = path.join(tmp(), 'terms.txt');
  fs.writeFileSync(terms, `${TERM}\n`);
  const run = scan(dir, ['--terms-file', terms]);
  assert.equal(run.status, 1);
  assert.deepEqual(run.json.findings.map(f => f.kind).sort(), ['session-id', 'session-link', 'term']);
  assert.equal(run.json.commits, 1);
});

test('scan: a terms file with CR-only line endings gives the right terms and line numbers', () => {
  const dir = repo();
  commit(dir, { 'n.md': `fine\nabout ${TERM}\n` });
  const terms = path.join(tmp(), 'terms.txt');
  fs.writeFileSync(terms, `# private\runrelated\r${TERM}\r`);
  const run = scan(dir, ['--terms-file', terms]);
  assert.equal(run.status, 1);
  assert.equal(run.json.termsChecked, 2);
  assert.deepEqual(run.json.findings.map(f => [f.kind, f.termLine]), [['term', 3]]);
});

test('scan: an empty range exits 1 with a clear message unless --allow-empty is given', () => {
  const noCommits = repo();
  let run = scan(noCommits);
  assert.equal(run.status, 1);
  assert.equal(run.json.ok, false);
  assert.equal(run.json.commits, 0);
  assert.match(run.json.emptyNote, /no commits/);
  assert.match(scan(noCommits, [], { json: false }).stdout, /NOT CLEAN.*no commits.*--allow-empty/);
  assert.equal(scan(noCommits, ['--allow-empty']).status, 0);
  const accepted = scan(noCommits, ['--allow-empty'], { json: false });
  assert.match(accepted.stdout, /\(0 commits, 0 added lines; accepted by --allow-empty\)/);
  assert.doesNotMatch(accepted.stdout, /clean/);
  const noLines = repo();
  fs.rmSync(path.join(noLines, 'a.txt'));
  git(noLines, 'add', '-A'); git(noLines, 'commit', '-qm', 'delete only');
  run = scan(noLines);
  assert.equal(run.status, 1);
  assert.match(run.json.emptyNote, /no added lines/);
  assert.equal(scan(noLines, ['--allow-empty']).status, 0);
});

test('scan: the output says how many terms were checked, or that none were', () => {
  const dir = repo();
  commit(dir, { 'b.txt': 'clean\n' });
  const terms = path.join(tmp(), 'terms.txt');
  fs.writeFileSync(terms, '# c\none\ntwo\n');
  assert.match(scan(dir, ['--terms-file', terms], { json: false }).stdout, /^terms: 2 checked$/m);
  assert.match(scan(dir, [], { json: false }).stdout, /^terms: NOT checked$/m);
  assert.equal(scan(dir, ['--terms-file', terms]).json.termsChecked, 2);
  assert.equal(scan(dir).json.termsChecked, null);
  const dirty = repo();
  commit(dirty, { 'c.txt': `${USERS}jane/x\n` });
  assert.match(scan(dirty, [], { json: false }).stdout, /^terms: NOT checked$/m, 'also printed when there are findings');
  assert.equal(formatResult({ ok: true, commits: 1, addedLines: 1, files: 1, total: 0, counts: {}, findings: [], termsChecked: 0, binaryFiles: 0, binaryScanned: [], unscanned: [], patchLines: 1, empty: false }).includes('terms: 0 checked'), true);
});

test('scan: a terms file with no terms (empty, blank, or only comments) is exit 2', () => {
  const dir = repo();
  commit(dir, { 'b.txt': 'clean\n' });
  for (const text of ['', '\n\n', '# only a comment\n\n# another\n']) {
    const terms = path.join(tmp(), 'terms.txt');
    fs.writeFileSync(terms, text);
    const run = scan(dir, ['--terms-file', terms]);
    assert.equal(run.status, 2, JSON.stringify(text));
    assert.match(run.json.error, /no terms/);
    assert.equal(run.json.ok, false);
  }
});

test('scan: file paths are scanned, and a finding names no path', () => {
  const dir = repo();
  const terms = path.join(tmp(), 'terms.txt');
  fs.writeFileSync(terms, `${TERM}\n`);
  commit(dir, { [`notes/${TERM.toLowerCase()}-plan.md`]: 'clean\n', [`mail/${EMAIL}.txt`]: 'clean\n', 'plain.txt': 'clean\n' });
  const run = scan(dir, ['--terms-file', terms]);
  assert.equal(run.status, 1);
  const pathFindings = run.json.findings.filter(f => f.file === 'file-path');
  assert.deepEqual(pathFindings.map(f => f.kind).sort(), ['email', 'term']);
  assert.equal(run.json.paths, 3);
  const output = run.stdout.toLowerCase();
  assert.equal(output.includes(TERM.toLowerCase()), false, 'no term in the output');
  assert.equal(output.includes('corp-mail'), false, 'no address in the output');
  assert.equal(output.includes('someone'), false);
});

test('scan: the author and committer names are scanned with the terms and the patterns', () => {
  const dir = repo();
  const terms = path.join(tmp(), 'terms.txt');
  fs.writeFileSync(terms, `${TERM}\n`);
  fs.writeFileSync(path.join(dir, 'b.txt'), 'clean\n');
  git(dir, 'add', '.');
  const made = spawnSync('git', ['commit', '-qm', 'named'], { cwd: dir, encoding: 'utf8', env: { ...GIT_ENV, GIT_AUTHOR_NAME: `${TERM} Person`, GIT_COMMITTER_NAME: `Other ${TERM.toLowerCase()}` } });
  assert.equal(made.status, 0, made.stderr);
  const run = scan(dir, ['--terms-file', terms]);
  assert.equal(run.status, 1);
  assert.deepEqual(run.json.findings.map(f => [f.kind, f.line]), [['term', 0], ['term', 0]]);
  assert.match(run.json.findings[0].file, /^commit:/);
  assert.equal(run.stdout.toLowerCase().includes(TERM.toLowerCase()), false);
});

test('scan: the new secret shapes are found and redacted, and placeholders are allowed', () => {
  for (const key of ['jwt', 'slack', 'google', 'authToken', 'authBasic', 'password', 'pem']) {
    const found = scanLine(`value: ${secrets[key]} end`);
    assert.deepEqual(found.map(f => f.kind), ['secret'], key);
    assert.equal(found[0].excerpt, '[redacted]', key);
    assert.equal(JSON.stringify(found).includes(secrets[key]), false, key);
  }
  for (const line of ['//registry.npmjs.org/:_auth' + 'Token=${NPM_TOKEN}', 'PASS' + 'WORD=$DB_PASS', 'pass' + 'word=<your password>', 'pass' + 'word = ***', 'the pass' + 'word is stored elsewhere', '_auth' + 'Token is documented here', 'ey' + 'J is a prefix and ey' + 'J.x is not a token']) {
    assert.deepEqual(kinds(line), [], line);
  }
});

test('scanLine finishes fast on very long lines', () => {
  const lines = ['a'.repeat(200000) + '@', 'a@'.repeat(100000), '.'.repeat(200000), USERS.repeat(30000), `${'a'.repeat(200000)}@x`, 'x'.repeat(WINDOW_CHARS * 5 + 1)];
  const started = performance.now();
  for (const line of lines) scanLine(line);
  assert.ok(performance.now() - started < 4000, `took ${Math.round(performance.now() - started)} ms`);
});

test('scanLine reads a long line in windows: a leak anywhere on it is found once, also across a window edge', () => {
  assert.equal(WINDOW_CHARS, 4000);
  assert.equal(WINDOW_OVERLAP, 200);
  const step = WINDOW_CHARS - WINDOW_OVERLAP;
  const filler = n => 'a '.repeat(Math.ceil(n / 2)).slice(0, n);
  const leak = secrets.ghp;
  // Starts in the first window, across the first edge, inside the overlap, in the second window, far along, and at the very end.
  for (const at of [10, WINDOW_CHARS - 20, WINDOW_CHARS - 1, step + 5, step + 100, 2 * step - 30, 50000, 199000]) {
    const text = filler(at) + ' ' + leak + ' ' + filler(1000);
    const found = scanLine(text);
    assert.deepEqual(found.map(f => f.kind), ['secret'], `leak at ${at}`);
    assert.equal(found[0].excerpt, '[redacted]');
  }
  assert.deepEqual(scanLine(filler(300000) + ' ' + leak).map(f => f.kind), ['secret']);
  // Two different leaks far apart, and a leak longer than the overlap that crosses an edge.
  assert.deepEqual(scanLine(leak + ' ' + filler(9000) + ' ' + EMAIL + ' ' + filler(9000) + ` ${USERS}jane/x`).map(f => f.kind), ['secret', 'email', 'home-path']);
  const longValue = '//registry.example.com/:_auth' + 'Token=' + 'q'.repeat(600);
  assert.deepEqual(scanLine(filler(WINDOW_CHARS - 300) + ' ' + longValue).map(f => f.kind), ['secret']);
  // A line with no leak stays clean, and a placeholder stays allowed, wherever it sits against a window edge (a cut of "you" must not read as another name).
  for (let at = 90; at < 4000; at += 1) assert.deepEqual(scanLine(filler(at) + ` ${USERS}you/x ` + filler(9000)), [], `placeholder at ${at}`);
  for (let at = step - 10; at < step + 20; at++) assert.deepEqual(scanLine(filler(at) + ` ${USERS}you/x ` + filler(9000)), [], `placeholder at ${at}`);
  // A long run of letters is not an email local part just because a window starts inside it.
  assert.deepEqual(scanLine('a'.repeat(WINDOW_CHARS * 3) + '@corp-mail.org'), []);
});

test('scanLine still checks terms on a line over one window, once per occurrence', () => {
  const found = scanLine('x'.repeat(WINDOW_CHARS * 2) + ` ${TERM} ` + 'y'.repeat(10), parseTerms(TERM));
  assert.deepEqual(found.map(f => f.kind), ['term']);
});

test('scanLine excerpts for home paths and emails are constants that never hold the real name or address', () => {
  const found = scanLine(`${USERS}jane/x ${HOME}jane/y ${WIN}jane\\z ${EMAIL}`);
  assert.deepEqual(found.map(f => f.kind), ['home-path', 'home-path', 'home-path', 'email']);
  assert.deepEqual(found.map(f => f.excerpt), [USERS + '[name]', HOME + '[name]', WIN + '[name]', '[redacted]@domain']);
  const json = JSON.stringify(found);
  assert.equal(json.includes('jane'), false);
  assert.equal(json.includes('corp-mail'), false);
  assert.equal(json.includes('someone'), false);
});

test('scan: a 200,000-character line in a file is scanned in windows: a leak and a term on it are both found', () => {
  const dir = repo();
  const terms = path.join(tmp(), 'terms.txt');
  fs.writeFileSync(terms, `${TERM}\n`);
  commit(dir, { 'bundle.min.js': 'a'.repeat(100000) + ` ${TERM} ` + 'b '.repeat(40000) + ` ${secrets.ghp} ` + 'c'.repeat(20000) + '\nsecond line\n' });
  const started = Date.now();
  const run = scan(dir, ['--terms-file', terms]);
  assert.ok(Date.now() - started < 30000);
  assert.equal(run.status, 1);
  assert.deepEqual(run.json.findings.map(f => [f.kind, f.file, f.line]), [['secret', 'bundle.min.js', 1], ['term', 'bundle.min.js', 1]]);
  assert.equal('longLinesSkipped' in run.json, false);
  assert.equal(run.stdout.includes(secrets.ghp), false);
  assert.doesNotMatch(scan(dir, ['--terms-file', terms], { json: false }).stdout, /not pattern-scanned|over 5000/);
});

test('scan: finds the right file and line even when the repository config changes the diff prefixes', () => {
  const dir = repo();
  git(dir, 'config', 'diff.noprefix', 'true');
  git(dir, 'config', 'diff.mnemonicPrefix', 'true');
  commit(dir, { 'sub/leaky.txt': `fine\nhome ${USERS}jane/x\n` });
  const run = scan(dir);
  assert.deepEqual(run.json.findings.map(f => [f.kind, f.file, f.line]), [['home-path', 'sub/leaky.txt', 2]]);
});

test('scan: usage errors print one JSON object with --json, a flag with a value is refused, and a base that starts with - is refused', () => {
  for (const argv of [['--json=x'], ['--allow-empty=false', '--json'], ['--base=--upload-pack=x', '--json'], ['--base', '-x', '--json'], ['--nope', '--json'], ['--terms-file', 'rel.txt', '--json']]) {
    const run = spawnSync(process.execPath, [script, ...argv], { encoding: 'utf8', env: GIT_ENV });
    assert.equal(run.status, 2, argv.join(' '));
    assert.equal(run.stdout.trim().split('\n').length, 1, argv.join(' '));
    const json = JSON.parse(run.stdout);
    assert.deepEqual({ ok: json.ok, exit: json.exit }, { ok: false, exit: 2 });
    assert.ok(json.error);
  }
  for (const bad of [['--json=false'], ['--allow-empty=0'], ['--help=1'], ['--base=--x'], ['--pr-body=--x'], ['--base', '-x']]) assert.ok(parseArgs(bad).usage, JSON.stringify(bad));
  assert.equal(parseArgs(['--allow-empty']).allowEmpty, true);
});

test('scan: exit 2 for an unknown base, outside a repository, or a missing terms file also prints one JSON object with --json', () => {
  const dir = repo();
  commit(dir, { 'b.txt': 'x\n' });
  const unknown = spawnSync(process.execPath, [script, '--base', 'no-such-ref', '--json'], { cwd: dir, encoding: 'utf8', env: GIT_ENV });
  const outside = spawnSync(process.execPath, [script, '--json'], { cwd: tmp(), encoding: 'utf8', env: { ...GIT_ENV, GIT_CEILING_DIRECTORIES: CEILING } });
  const missing = scan(dir, ['--terms-file', path.join(tmp(), 'absent.txt')]);
  for (const run of [unknown, outside, missing]) {
    assert.equal(run.status, 2);
    const json = run.json ?? JSON.parse(run.stdout);
    assert.deepEqual({ ok: json.ok, exit: json.exit }, { ok: false, exit: 2 });
    assert.equal(run.stdout.trim().split('\n').length, 1);
  }
  assert.match(unknown.stderr, /base/);
});

test('scan: a word that is the name of an Object.prototype member is a usage error, not a flag', () => {
  for (const word of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
    assert.match(parseArgs([word]).usage ?? '', /unknown argument/, word);
    assert.match(parseArgs([`--${word}`]).usage ?? '', /unknown argument/, word);
  }
  const run = spawnSync(process.execPath, [script, 'constructor', '--json'], { encoding: 'utf8' });
  assert.equal(run.status, 2);
  assert.equal(JSON.parse(run.stdout).exit, 2);
});

test('scan: a different file named public-scan.mjs that imports the real one makes it print an error and exit 2', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'public-scan.mjs'), `import ${JSON.stringify(script)};\n`);
  const run = spawnSync(process.execPath, [path.join(dir, 'public-scan.mjs'), '--help'], { encoding: 'utf8' });
  assert.equal(run.status, 2);
  assert.match(run.stderr, /public-scan: the program started as .* is not this script/);
  assert.equal(run.stdout, '');
  const viaLink = path.join(dir, 'link-name.mjs');
  fs.symlinkSync(script, viaLink);
  assert.equal(spawnSync(process.execPath, [viaLink, '--help'], { encoding: 'utf8' }).status, 0, 'a symlink to the real file still runs');
});

test('scan: the scanner finds nothing in its own source and test files', () => {
  const files = ['../public-scan.mjs', './public-scan.test.mjs', '../gates.mjs', '../lane-tree.mjs', '../lib/run-child.mjs', '../lib/safe-env.mjs', '../lib/output-parse.mjs', '../lib/cli.mjs', '../lib/interrupt.mjs',
    './gates.test.mjs', './lane-tree.test.mjs', './interrupt.test.mjs', './safe-env.test.mjs', './output-parse.test.mjs', './cli.test.mjs', './run-child.test.mjs', './manifest.test.mjs'];
  for (const file of files) {
    const text = fs.readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8');
    const hits = text.split('\n').flatMap((line, i) => scanLine(line).map(f => `${file}:${i + 1} ${f.kind}`));
    assert.deepEqual(hits, [], file);
  }
});
