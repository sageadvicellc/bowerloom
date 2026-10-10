import '../../../dist/tests/support/isolate-home.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { denyNetwork, fakeTransport, repository } from './support/fixtures.mjs';
import { GIT, gitResponses, gitRepo, gitVerificationLoop, gitVerificationLoopUrls, privateFolder } from './support/expected.mjs';
import { GIT_ITEMS, GIT_REPO, GIT_COMMIT } from './fixtures/record.mjs';
import { resolveGit, resolveGitVerified } from '../../../dist/packages/skill-manifest/src/resolve-git.js';
import { parseSkillSpec } from '../../../dist/packages/skill-manifest/src/spec.js';
import { toGitRequest } from '../../../dist/packages/skill-manifest/src/requests.js';
import { planGitAcquisition, verifyGitPayload } from '../../../dist/packages/skill-sources/src/git.js';
import { observeSkillCacheRoot } from '../../../dist/packages/skill-sources/src/cache.js';

const network = denyNetwork();
test.after(() => assert.deepEqual(network, [], 'no test in this file touches the network'));
const code = expected => error => error?.code === expected && !/NEVER_EXECUTE|Ignore all previous/.test(error.message);
const spec = (path, commit = GIT_COMMIT) => parseSkillSpec(`github:${GIT_REPO}@${commit}:${path}`);
const signal = () => new AbortController().signal;
const api = `https://api.github.com/repos/${GIT_REPO}/git`;
const variant = items => fakeTransport(repository(GIT_REPO, GIT_COMMIT, items).responses);
const MIT = GIT_ITEMS.find(i => i.path === 'LICENSE').text;

test('a GitHub skill resolves with the LICENSE beside a walked tree, through exactly the reads acquisition makes', async t => {
  const transport = fakeTransport(gitResponses());
  const resolved = await resolveGit(spec('skills/verification-loop'), transport, signal());
  assert.deepEqual(resolved, gitVerificationLoop());
  assert.deepEqual(transport.urls, gitVerificationLoopUrls());
  assert.ok(transport.urls.every(url => url.startsWith('https://api.github.com/repos/synthetic-owner/skills-repo/git/')));
  // The existing verifier accepts the entry against the same recorded bytes, and acquisition would read the same URLs.
  const binding = observeSkillCacheRoot(privateFolder(t), 'd'.repeat(32), 12582912);
  const plan = planGitAcquisition(toGitRequest({ id: 'verification-loop', ...resolved }), binding);
  assert.deepEqual([plan.metadataUrl, ...plan.treeUrls], transport.urls.slice(0, 4));
  const responses = gitResponses();
  const payload = Buffer.from(JSON.stringify({
    trees: plan.treeUrls.map(url => responses.get(url).toString('base64')),
    blobs: transport.urls.slice(4).map(url => ({ sha: url.split('/').at(-1), body: responses.get(url).toString('base64') })),
  }));
  const observed = await verifyGitPayload(plan, responses.get(plan.metadataUrl), payload, signal(), () => {});
  assert.equal(observed.skill.name, 'verification-loop'); assert.equal(observed.files.length, 3);
});

test('a skill with its own LICENSE uses it, and an Apache header is detected exactly', async () => {
  const apache = '                                 Apache License\n                           Version 2.0, January 2004\n                        http://www.apache.org/licenses/\n';
  const resolved = await resolveGit(spec('skills/evidence-review'), variant([...GIT_ITEMS, { path: 'skills/evidence-review/LICENSE.txt', text: apache }]), signal());
  assert.deepEqual(resolved.license, { spdx: 'Apache-2.0', files: ['LICENSE.txt'] });
  assert.equal(resolved.files.find(f => f.path === 'LICENSE.txt').sourcePath, 'skills/evidence-review/LICENSE.txt');
  assert.equal(resolved.files.some(f => f.sourcePath === 'LICENSE'), false);
  // "The MIT License (MIT)" is the other exact MIT header.
  const classic = await resolveGit(spec('skills/evidence-review'), variant(GIT_ITEMS.map(i => i.path === 'LICENSE' ? { ...i, text: 'The MIT License (MIT)\n\nCopyright (c) 2026 Synthetic\n' } : i)), signal());
  assert.equal(classic.license.spdx, 'MIT');
});

test('an unknown or missing license is refused', async () => {
  for (const items of [
    GIT_ITEMS.filter(i => i.path !== 'LICENSE'),
    GIT_ITEMS.map(i => i.path === 'LICENSE' ? { ...i, text: '                    GNU GENERAL PUBLIC LICENSE\n                       Version 3, 29 June 2007\n' } : i),
    GIT_ITEMS.map(i => i.path === 'LICENSE' ? { ...i, text: 'Copyright (c) 2026. Permission is granted under the MIT License terms.\n' } : i),
    GIT_ITEMS.map(i => i.path === 'LICENSE' ? { ...i, text: 'Apache License\nVersion 1.1\n' } : i),
    // A license in an unrelated folder is not beside the walked path.
    [...GIT_ITEMS.filter(i => i.path !== 'LICENSE'), { path: 'docs/LICENSE', text: MIT }],
  ]) await assert.rejects(resolveGit(spec('skills/verification-loop'), variant(items), signal()), code('SKILLS_ADD_LICENSE_UNKNOWN'));
});

test('a symlink, a submodule, an executable, a hidden file or a script in the skill is unsafe; a link elsewhere in the repository is not read', async () => {
  const root = 'skills/verification-loop';
  for (const extra of [{ path: `${root}/references/link.md`, link: '../../../README.md' }, { path: `${root}/vendor`, submodule: true }, { path: `${root}/run.md`, text: '# run\n', mode: '100755' }, { path: `${root}/scripts/run.sh`, text: 'echo NEVER_EXECUTE\n' }, { path: `${root}/.env.md`, text: 'x\n' }]) {
    await assert.rejects(resolveGit(spec(root), variant([...GIT_ITEMS, extra]), signal()), code('SKILLS_ADD_UNSAFE_CONTENT'), extra.path);
  }
  // The path itself must not pass through a link or a submodule.
  await assert.rejects(resolveGit(spec('linked/x'), variant([...GIT_ITEMS, { path: 'linked', link: 'skills' }]), signal()), code('SKILLS_ADD_UNSAFE_CONTENT'));
  await assert.rejects(resolveGit(spec('sub/x'), variant([...GIT_ITEMS, { path: 'sub', submodule: true }]), signal()), code('SKILLS_ADD_UNSAFE_CONTENT'));
  // The recorded root holds a symlink (bin/run) outside the path: it is hashed, never followed, and the add succeeds.
  assert.equal((await resolveGit(spec(root), fakeTransport(gitResponses()), signal())).skill.name, 'verification-loop');
});

test('an oversize file is refused from the tree listing, before any blob is read', async () => {
  const root = 'skills/verification-loop', transport = variant([...GIT_ITEMS, { path: `${root}/references/huge.md`, text: '#'.repeat(65537) }]);
  await assert.rejects(resolveGit(spec(root), transport, signal()), code('SKILLS_ADD_UNSAFE_CONTENT'));
  assert.equal(transport.urls.some(url => url.includes('/blobs/')), false);
});

test('a missing path, a file in place of a folder, and a folder with no SKILL.md are refused', async () => {
  await assert.rejects(resolveGit(spec('skills/nothing'), fakeTransport(gitResponses()), signal()), code('SKILLS_ADD_NOT_FOUND'));
  await assert.rejects(resolveGit(spec('README.md/x'), fakeTransport(gitResponses()), signal()), code('SKILLS_ADD_NOT_FOUND'));
  await assert.rejects(resolveGit(spec('skills'), fakeTransport(gitResponses()), signal()), code('SKILLS_ADD_SKILL_MISSING'));
  await assert.rejects(resolveGit(spec('skills/verification-loop', 'f'.repeat(40)), fakeTransport(gitResponses()), signal()), code('SKILLS_ADD_NOT_FOUND'));
});

test('a response that does not prove its own pin is unsafe content', async () => {
  const responses = gitResponses(), repo = gitRepo(), root = 'skills/verification-loop';
  const commitUrl = `${api}/commits/${GIT_COMMIT}`, rootUrl = `${api}/trees/${repo.root}`, skillUrl = `${api}/trees/${repo.tree(root)}?recursive=1`;
  const edit = (url, change) => fakeTransport(responses, { override: u => u === url ? Buffer.from(JSON.stringify(change(JSON.parse(responses.get(url))))) : undefined });
  for (const transport of [
    edit(commitUrl, v => ({ ...v, sha: 'e'.repeat(40) })),
    edit(commitUrl, v => ({ ...v, tree: { sha: 'short' } })),
    edit(rootUrl, v => ({ ...v, truncated: true })),
    edit(rootUrl, v => ({ ...v, tree: v.tree.filter(e => e.path !== 'README.md') })),
    edit(skillUrl, v => ({ ...v, tree: v.tree.map(e => e.path === 'SKILL.md' ? { ...e, size: e.size + 1 } : e) })),
    edit(`${api}/blobs/${repo.blob(GIT_ITEMS.find(i => i.path === `${root}/SKILL.md`).text)}`, v => ({ ...v, content: Buffer.from('---\nname: verification-loop\ndescription: swapped\n---\n').toString('base64') })),
    fakeTransport(responses, { override: u => u === skillUrl ? Buffer.from('{"sha":1') : undefined }),
  ]) await assert.rejects(resolveGit(spec(root), transport, signal()), code('SKILLS_ADD_UNSAFE_CONTENT'));
});

test('an aborted signal stops before the first request, and only a parsed GitHub spec is accepted', async () => {
  const transport = fakeTransport(gitResponses()), controller = new AbortController(); controller.abort();
  await assert.rejects(resolveGit(spec('skills/verification-loop'), transport, controller.signal), code('SKILLS_ADD_NETWORK'));
  for (const bad of [{ kind: 'github', repository: GIT_REPO, commit: 'main', path: 'skills/x' }, { kind: 'npm' }, undefined, { kind: 'github', repository: '../x', commit: GIT_COMMIT, path: 'skills/x' }]) {
    await assert.rejects(resolveGit(bad, transport, signal()), e => ['SKILLS_ADD_SPEC_INVALID', 'MANIFEST_PIN_NOT_EXACT'].includes(e?.code));
  }
  assert.deepEqual(transport.urls, []);
  assert.equal(GIT.commit, GIT_COMMIT);
});

test('resolveGitVerified returns the entry and the exact payload it verified, in the form the Git cache stores', async t => {
  const transport = fakeTransport(gitResponses());
  const { content, bytes } = await resolveGitVerified(spec('skills/verification-loop'), transport, signal());
  assert.deepEqual(content, gitVerificationLoop()); assert.deepEqual(transport.urls, gitVerificationLoopUrls());
  const plan = planGitAcquisition(toGitRequest({ id: 'verification-loop', ...content }), observeSkillCacheRoot(privateFolder(t), 'f'.repeat(32), 12582912));
  assert.equal(bytes.kind, 'git'); assert.ok(bytes.metadata.equals(gitResponses().get(plan.metadataUrl)));
  assert.equal((await verifyGitPayload(plan, bytes.metadata, bytes.data, signal(), () => {})).files.length, 3);
});
