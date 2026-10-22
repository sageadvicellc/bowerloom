// Spec 06, 3.10 and 3.11: fetchAuthored and proveAuthored read an authored store item at one commit of a github.com
// store, through one public transport, with a fake PublicTransport over buildFakeRepo responses.
import '../../../dist/tests/support/isolate-home.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import https from 'node:https';
import dns from 'node:dns/promises';
import { EventEmitter } from 'node:events';
import { syncBuiltinESMExports } from 'node:module';
import { denyNetwork, fakeTransport } from './support/fixtures.mjs';
import { fetchAuthored, proveAuthored, authoredRows } from '../../../dist/packages/skill-manifest/src/resolve-store-git.js';
import { createPublicTransport } from '../../../dist/packages/skill-manifest/src/public-get.js';
import { revisionOf } from '../../../dist/packages/skill-sources/src/validation.js';
import { buildFakeRepo } from '../../../dist/tests/support/fake-github-repo.js';

const denied = denyNetwork();
test.after(() => assert.deepEqual(denied, [], 'no test in this file reaches the real network'));
const code = expected => error => { if (error?.code !== expected) throw new Error(`expected ${expected}, got ${error?.code ?? error}`); return true; };
const signal = () => new AbortController().signal;
const COMMIT = '0123456789abcdef0123456789abcdef01234567', REMOTE = 'https://github.com/sageadvicellc/store';
const SKILL = '---\nname: house-style\ndescription: A store skill.\n---\nUse the house style.\n';
const FILES = {
  'store.json': '{"format":"bowerloom/store/v1beta1"}\n',
  'skills/house-style/SKILL.md': SKILL, 'skills/house-style/references/notes.md': '# Notes\n',
  'prompts/weekly-update.md': 'Summarize the week.\n',
  'teams/research/team.yaml': 'id: research\n', 'teams/research/agents/lead.md': '# Lead\n',
};
const dirs = [];
test.after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
function repo(files = FILES) { const dir = fs.mkdtempSync(`${process.env.HOME}/store-repo-`); dirs.push(dir); return buildFakeRepo('sageadvicellc', 'store', files, COMMIT, dir); }
const transportOf = (r, options) => fakeTransport(r.responses, options);
const at = (kind, id) => ({ remote: REMOTE, commit: COMMIT, kind, id });
const rows = files => authoredRows(files).rows;

test('1 and 2. fetchAuthored returns the files of a skill, a prompt, and a team, sorted, with the item tree, and the hash is revisionOf the rows', async () => {
  const r = repo();
  const skill = await fetchAuthored(transportOf(r), at('skill', 'house-style'), signal());
  assert.equal(skill.tree, r.treeAt('skills/house-style'));
  assert.deepEqual(skill.files.map(f => [f.path, f.bytes.toString('utf8')]), [['SKILL.md', SKILL], ['references/notes.md', '# Notes\n']]);
  const prompt = await fetchAuthored(transportOf(r), at('prompt', 'weekly-update'), signal());
  assert.equal(prompt.tree, r.blobId('Summarize the week.\n'));
  assert.deepEqual(prompt.files.map(f => [f.path, f.bytes.toString('utf8')]), [['weekly-update.md', 'Summarize the week.\n']]);
  const team = await fetchAuthored(transportOf(r), at('team', 'research'), signal());
  assert.equal(team.tree, r.treeAt('teams/research'));
  assert.deepEqual(team.files.map(f => f.path), ['agents/lead.md', 'team.yaml']);
  const { rows: inventory, hash } = authoredRows(skill.files);
  assert.equal(hash, revisionOf(inventory));
  assert.deepEqual(inventory.map(x => x.path), ['SKILL.md', 'references/notes.md']);
});

test('3. a symlink row, a submodule row, a mode 100755 row, a .png file, a file over 65536 bytes, 127 files, and more than 2 MiB each refuse', async () => {
  const base = { ...FILES };
  const cases = [
    { 'skills/house-style/link.md': { link: 'SKILL.md' } },
    { 'skills/house-style/vendor': { submodule: true } },
    { 'skills/house-style/run.md': { text: 'x\n', mode: '100755' } },
    { 'skills/house-style/logo.png': 'x' },
    { 'skills/house-style/big.md': 'x'.repeat(65537) },
    Object.fromEntries(Array.from({ length: 125 }, (_, i) => [`skills/house-style/n/${String(i).padStart(3, '0')}.md`, `${i}\n`])),
    Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`skills/house-style/big/${String(i).padStart(2, '0')}.md`, `${i}`.padEnd(65536, 'x')])),
  ];
  for (const extra of cases) {
    const transport = transportOf(repo({ ...base, ...extra }));
    await assert.rejects(fetchAuthored(transport, at('skill', 'house-style'), signal()), code('SKILLS_ADD_UNSAFE_CONTENT'), Object.keys(extra)[0]);
    assert.equal(transport.urls.some(u => u.includes('/blobs/')), false, 'no blob is read before the listing passes');
  }
  // 126 files pass.
  const ok = Object.fromEntries(Array.from({ length: 124 }, (_, i) => [`skills/house-style/n/${String(i).padStart(3, '0')}.md`, `${i}\n`]));
  assert.equal((await fetchAuthored(transportOf(repo({ ...base, ...ok })), at('skill', 'house-style'), signal())).files.length, 126);
});

test('4. a skill without SKILL.md, a team without team.yaml, and a folder in place of a prompt file refuse', async () => {
  const noSkill = { ...FILES }; delete noSkill['skills/house-style/SKILL.md'];
  await assert.rejects(fetchAuthored(transportOf(repo(noSkill)), at('skill', 'house-style'), signal()), code('SKILLS_ADD_UNSAFE_CONTENT'));
  const noTeam = { ...FILES }; delete noTeam['teams/research/team.yaml'];
  await assert.rejects(fetchAuthored(transportOf(repo(noTeam)), at('team', 'research'), signal()), code('SKILLS_ADD_UNSAFE_CONTENT'));
  const folderPrompt = { ...FILES, 'prompts/weekly-update.md/x.md': 'x\n' }; delete folderPrompt['prompts/weekly-update.md'];
  await assert.rejects(fetchAuthored(transportOf(repo(folderPrompt)), at('prompt', 'weekly-update'), signal()), code('SKILLS_ADD_UNSAFE_CONTENT'));
});

/** A transport whose response for `url` is replaced by `edit` of the parsed JSON. */
const edited = (r, match, edit) => transportOf(r, { override: url => match(url) ? Buffer.from(JSON.stringify(edit(JSON.parse(r.responses.get(url).toString('utf8'))))) : undefined });

test('5 and 14. a tree listing whose rows do not rebuild to its sha refuses', async () => {
  const r = repo(), skills = r.treeAt('skills');
  const transport = edited(r, url => url.endsWith(`/trees/${skills}`), v => ({ ...v, tree: v.tree.map(row => ({ ...row, sha: row.sha.replace(/^./, c => c === 'a' ? 'b' : 'a') })) }));
  await assert.rejects(fetchAuthored(transport, at('skill', 'house-style'), signal()), code('SKILLS_ADD_UNSAFE_CONTENT'));
  const item = r.treeAt('skills/house-style');
  const recursive = edited(r, url => url.endsWith(`/trees/${item}?recursive=1`), v => ({ ...v, tree: v.tree.filter(row => row.path !== 'references/notes.md') }));
  await assert.rejects(fetchAuthored(recursive, at('skill', 'house-style'), signal()), code('SKILLS_ADD_UNSAFE_CONTENT'));
});

test('6. a truncated listing refuses', async () => {
  const r = repo(), item = r.treeAt('skills/house-style');
  await assert.rejects(fetchAuthored(edited(r, url => url.endsWith('?recursive=1') && url.includes(item), v => ({ ...v, truncated: true })), at('skill', 'house-style'), signal()), code('SKILLS_ADD_UNSAFE_CONTENT'));
});

test('7. a blob whose bytes do not match its sha refuses', async () => {
  const r = repo(), id = r.blobId('# Notes\n');
  await assert.rejects(fetchAuthored(edited(r, url => url.endsWith(`/blobs/${id}`), v => ({ ...v, content: Buffer.from('# Notez\n').toString('base64') })), at('skill', 'house-style'), signal()), code('SKILLS_ADD_UNSAFE_CONTENT'));
});

test('8. a 404 on the commit request gives the outcome commit-missing from proveAuthored', async () => {
  const r = repo(), transport = transportOf(r, { override: url => url.includes('/commits/') ? undefined : undefined });
  const other = { ...at('skill', 'house-style'), commit: 'f'.repeat(40) };
  assert.deepEqual(await proveAuthored(transport, other, 'a'.repeat(64), signal()), { outcome: 'commit-missing' });
  assert.equal(transport.urls.length, 1);
});

test('9. proveAuthored: not-pushed for a hash that differs by one byte or a missing item path; proved with the pin for equal hashes; manifest refusals only', async () => {
  const r = repo(), local = authoredRows([{ path: 'SKILL.md', bytes: Buffer.from(SKILL) }, { path: 'references/notes.md', bytes: Buffer.from('# Notes\n') }]);
  const proved = await proveAuthored(transportOf(r), { ...at('skill', 'house-style'), teams: ['research'] }, local.hash, signal());
  assert.deepEqual(proved, { outcome: 'proved', pin: { remote: REMOTE, commit: COMMIT, path: 'skills/house-style', tree: r.treeAt('skills/house-style'), files: local.rows, hash: local.hash, teams: ['research'] } });
  const changed = authoredRows([{ path: 'SKILL.md', bytes: Buffer.from(SKILL) }, { path: 'references/notes.md', bytes: Buffer.from('# Notes!\n') }]);
  assert.deepEqual(await proveAuthored(transportOf(r), at('skill', 'house-style'), changed.hash, signal()), { outcome: 'not-pushed' });
  assert.deepEqual(await proveAuthored(transportOf(r), at('skill', 'other-skill'), local.hash, signal()), { outcome: 'not-pushed' });
  // A team pin carries no teams tag.
  const team = await proveAuthored(transportOf(r), { ...at('team', 'research'), teams: ['x'] }, authoredRows([{ path: 'agents/lead.md', bytes: Buffer.from('# Lead\n') }, { path: 'team.yaml', bytes: Buffer.from('id: research\n') }]).hash, signal());
  assert.equal(team.outcome, 'proved'); assert.equal('teams' in team.pin, false);
  // Unsafe content is a manifest refusal, thrown.
  await assert.rejects(proveAuthored(transportOf(repo({ ...FILES, 'skills/house-style/x.png': 'x' })), at('skill', 'house-style'), local.hash, signal()), code('SKILLS_ADD_UNSAFE_CONTENT'));
});

test('10. requests use only api.github.com URLs, and no Authorization header is set', async t => {
  const r = repo(), seen = [];
  t.mock.method(dns, 'lookup', async () => [{ address: '104.16.25.34', family: 4 }]);
  t.mock.method(https, 'request', (url, options, callback) => {
    seen.push({ url, headers: options.headers });
    const req = new EventEmitter(); req.destroy = () => req;
    req.end = () => { queueMicrotask(() => { const body = r.responses.get(url) ?? Buffer.from('{}'); const res = new EventEmitter(); res.destroy = () => res; res.statusCode = r.responses.has(url) ? 200 : 404; res.complete = true; res.rawHeaders = ['Content-Length', String(body.length)]; res.headers = { 'content-length': String(body.length) }; callback(res); res.emit('data', body); res.emit('end'); }); return req; };
    return req;
  });
  syncBuiltinESMExports();
  const transport = createPublicTransport();
  try { await fetchAuthored(transport, at('skill', 'house-style'), signal()); } finally { transport.close(); t.mock.restoreAll(); syncBuiltinESMExports(); }
  assert.ok(seen.length > 0);
  for (const s of seen) { assert.ok(String(s.url).startsWith('https://api.github.com/repos/sageadvicellc/store/git/'), s.url); assert.equal(Object.keys(s.headers).some(h => h.toLowerCase() === 'authorization'), false); }
});

test('11. a skill or team takes 4 requests plus one per distinct blob; a prompt takes 4; 126 distinct blobs take 130', async () => {
  const r = repo();
  const count = async (kind, id, transport = transportOf(r)) => { await fetchAuthored(transport, at(kind, id), signal()); return transport.urls.length; };
  assert.equal(await count('skill', 'house-style'), 6);
  assert.equal(await count('prompt', 'weekly-update'), 4);
  const ten = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`teams/big/${i === 0 ? 'team.yaml' : `agents/a${i}.md`}`, `${i}\n`]));
  assert.equal(await count('team', 'big', transportOf(repo({ ...FILES, ...ten }))), 14);
  // Two files with the same bytes share one blob request.
  const twins = repo({ ...FILES, 'skills/twins/SKILL.md': 'same\n', 'skills/twins/copy.md': 'same\n' });
  assert.equal(await count('skill', 'twins', transportOf(twins)), 5);
  const max = Object.fromEntries(Array.from({ length: 126 }, (_, i) => [i === 0 ? 'skills/max/SKILL.md' : `skills/max/r/${String(i).padStart(3, '0')}.md`, `${i}\n`]));
  const maxRepo = repo({ ...FILES, ...max });
  assert.equal(await count('skill', 'max', transportOf(maxRepo)), 130);
  // Section 12, item 11 (fallback): with `next`, each group of 40 blobs after the first gets its own transport, closed after it.
  const first = transportOf(maxRepo), more = [];
  const next = () => { const t2 = transportOf(maxRepo); const one = { urls: t2.urls, get: t2.get, closed: false, close() { one.closed = true; } }; more.push(one); return one; };
  const fetched = await fetchAuthored(first, at('skill', 'max'), signal(), next);
  assert.equal(fetched.files.length, 126);
  assert.deepEqual([first.urls.length, ...more.map(m => m.urls.length)], [44, 40, 40, 6]);
  assert.ok(more.every(m => m.closed));
  assert.ok([...first.urls, ...more.flatMap(m => m.urls)].every(u => u.startsWith('https://api.github.com/')));
});

test('12. a missing segment row: proveAuthored gives not-pushed, and fetchAuthored throws SKILLS_ADD_NOT_FOUND', async () => {
  const noPrompts = { ...FILES }; delete noPrompts['prompts/weekly-update.md'];
  const r = repo(noPrompts);
  assert.deepEqual(await proveAuthored(transportOf(r), at('prompt', 'weekly-update'), 'a'.repeat(64), signal()), { outcome: 'not-pushed' });
  await assert.rejects(fetchAuthored(transportOf(r), at('prompt', 'weekly-update'), signal()), code('SKILLS_ADD_NOT_FOUND'));
  await assert.rejects(fetchAuthored(transportOf(r), at('team', 'other'), signal()), code('SKILLS_ADD_NOT_FOUND'));
});

/** A fake https.request and dns.lookup that answer every GET with `status` and `headers`. */
function statusNetwork(t, status, headers) {
  t.mock.method(dns, 'lookup', async () => [{ address: '104.16.25.34', family: 4 }]);
  t.mock.method(https, 'request', (url, options, callback) => {
    const req = new EventEmitter(); req.destroy = () => req;
    req.end = () => { queueMicrotask(() => { const body = Buffer.from('{"message":"limit"}'); const res = new EventEmitter(); res.destroy = () => res; res.statusCode = status; res.complete = true; const raw = ['Content-Length', String(body.length), ...Object.entries(headers).flat()]; res.rawHeaders = raw; res.headers = Object.fromEntries(Object.entries({ 'content-length': String(body.length), ...headers }).map(([k, v]) => [k.toLowerCase(), v])); callback(res); res.emit('data', body); res.emit('end'); }); return req; };
    return req;
  });
  syncBuiltinESMExports();
}
test('13. in the transport, a 429, a 403 with x-ratelimit-remaining 0, and a 403 with retry-after give GITHUB_RATE_LIMITED; a 403 with requests left, or a 5xx, gives GITHUB_REQUEST_FAILED with its status (review F3)', async t => {
  const url = `https://api.github.com/repos/sageadvicellc/store/git/commits/${COMMIT}`;
  for (const [status, headers, expected] of [
    [429, {}, 'GITHUB_RATE_LIMITED'], [403, { 'X-RateLimit-Remaining': '0' }, 'GITHUB_RATE_LIMITED'], [403, { 'Retry-After': '60' }, 'GITHUB_RATE_LIMITED'],
    [403, { 'X-RateLimit-Remaining': '5' }, 'GITHUB_REQUEST_FAILED'], [403, {}, 'GITHUB_REQUEST_FAILED'], [500, { 'Retry-After': '60' }, 'GITHUB_REQUEST_FAILED'],
  ]) {
    statusNetwork(t, status, headers);
    const transport = createPublicTransport();
    try { await assert.rejects(transport.get(url, 1024, signal()), code(expected), `${status} ${JSON.stringify(headers)}`); }
    finally { transport.close(); t.mock.restoreAll(); syncBuiltinESMExports(); }
  }
  // registry.npmjs.org keeps today's result for a 429.
  statusNetwork(t, 429, {});
  const transport = createPublicTransport();
  try { await assert.rejects(transport.get('https://registry.npmjs.org/x/1.0.0', 1024, signal()), code('SKILLS_ADD_NETWORK')); }
  finally { transport.close(); t.mock.restoreAll(); syncBuiltinESMExports(); }
  // A GITHUB_RATE_LIMITED from the transport keeps its code through fetchAuthored.
  const limited = { urls: [], async get(u) { this.urls.push(u); const { manifestRefusal } = await import('../../../dist/packages/skill-manifest/src/refusal.js'); throw manifestRefusal('GITHUB_RATE_LIMITED'); } };
  await assert.rejects(fetchAuthored(limited, at('skill', 'house-style'), signal()), code('GITHUB_RATE_LIMITED'));
});

test('a remote that is not the normal form, or an unsafe id, never reaches the transport', async () => {
  const transport = transportOf(repo());
  await assert.rejects(fetchAuthored(transport, { ...at('skill', 'house-style'), remote: 'https://github.com/Sage/Store' }, signal()), code('SKILLS_ADD_HOST_REFUSED'));
  await assert.rejects(fetchAuthored(transport, { ...at('skill', 'house-style'), remote: 'https://gitlab.com/o/r' }, signal()), code('SKILLS_ADD_HOST_REFUSED'));
  await assert.rejects(fetchAuthored(transport, { ...at('skill', '../x') }, signal()), code('SKILLS_ADD_SPEC_INVALID'));
  await assert.rejects(fetchAuthored(transport, { ...at('skill', 'house-style'), commit: 'HEAD' }, signal()), code('SKILLS_ADD_SPEC_INVALID'));
  assert.equal(transport.urls.length, 0);
});

// Spec 07, section 10: with a token for the approved repository, every request of one walk carries the header; for any
// other repository, none does. The real transport runs over a stubbed https.request.
test('spec 07. a token transport sends the header on every request of a walk of the approved repository, and on none of another', async t => {
  const { GithubToken } = await import('../../../dist/packages/skill-manifest/src/github-token.js');
  const token = GithubToken.fromEnv({ BOWERLOOM_GITHUB_TOKEN: 'ghp_' + 'g'.repeat(36) });
  const walk = async (owner, approved) => {
    const r = buildFakeRepo(owner, 'store', FILES, COMMIT, fs.mkdtempSync(`${process.env.HOME}/store-repo-`)), seen = [];
    t.mock.method(dns, 'lookup', async () => [{ address: '104.16.25.34', family: 4 }]);
    t.mock.method(https, 'request', (url, options, callback) => {
      seen.push({ url, auth: Object.keys(options.headers).some(h => h.toLowerCase() === 'authorization') });
      const req = new EventEmitter(); req.destroy = () => req;
      req.end = () => { queueMicrotask(() => { const body = r.responses.get(url) ?? Buffer.from('{}'); const res = new EventEmitter(); res.destroy = () => res; res.statusCode = r.responses.has(url) ? 200 : 404; res.complete = true; res.rawHeaders = ['Content-Length', String(body.length)]; res.headers = { 'content-length': String(body.length) }; callback(res); res.emit('data', body); res.emit('end'); }); return req; };
      return req;
    });
    syncBuiltinESMExports();
    const transport = createPublicTransport({ githubAuth: { token, repositories: [approved] } });
    try { await fetchAuthored(transport, { remote: `https://github.com/${owner}/store`, commit: COMMIT, kind: 'skill', id: 'house-style' }, signal()); } finally { transport.close(); t.mock.restoreAll(); syncBuiltinESMExports(); }
    return seen;
  };
  const mine = await walk('sageadvicellc', 'sageadvicellc/store');
  assert.equal(mine.length, 6); assert.ok(mine.every(s => s.auth), JSON.stringify(mine));
  const other = await walk('other-org', 'sageadvicellc/store');
  assert.equal(other.length, 6); assert.ok(other.every(s => !s.auth), JSON.stringify(other));
});
