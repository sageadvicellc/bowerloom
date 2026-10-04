import { test } from 'node:test';
import assert from 'node:assert/strict';
import { githubReadWorkflow } from './github-read.mjs';

const source = { owner: 'example-org', repo: 'experiments', commit: 'a'.repeat(40), path: 'experiments/completed.json' };
test('exports an immutable, credential-free GET with no automatic trigger or mutation', () => {
  const result = githubReadWorkflow(source);
  assert.equal(result.active, false);
  assert.equal(result.nodes.length, 2);
  assert.equal(result.nodes[0].type, 'n8n-nodes-base.manualTrigger');
  assert.equal(result.nodes[1].parameters.method, 'GET');
  assert.equal(result.nodes[1].parameters.url, `https://api.github.com/repos/example-org/experiments/contents/experiments/completed.json?ref=${source.commit}`);
  assert.equal(result.nodes[1].parameters.options.redirect.redirect.followRedirects, false);
  assert.ok(result.nodes.every(node => !('credentials' in node)));
  assert.deepEqual(result, githubReadWorkflow(source));
  assert.notEqual(result.name, githubReadWorkflow({ ...source, commit: 'b'.repeat(40) }).name);
});
test('rejects mutable refs, source escape, expressions, secret fields and unsupported files', () => {
  for (const input of [
    { ...source, commit: 'main' }, { ...source, commit: 'a'.repeat(41) },
    { ...source, owner: 'https://evil.test' }, { ...source, repo: '../secrets' },
    { ...source, path: '../secret.json' }, { ...source, path: '/secret.json' },
    { ...source, path: 'a/../secret.json' }, { ...source, path: 'a/%2e%2e/secret.json' },
    { ...source, path: 'a/.env.json' }, { ...source, path: 'a/file.js' },
    { ...source, path: 'a/file.json?ref=main' }, { ...source, repo: '={{ $env.TOKEN }}' },
    { ...source, token: 'secret' }, { ...source, path: 'a\\secret.json' },
  ]) assert.throws(() => githubReadWorkflow(input), /INVALID_GITHUB_SOURCE/);
});
