import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

function cli(...args: string[]) {
  const result = spawnSync(process.execPath, ['dist/apps/cli/src/main.js', ...args], { encoding: 'utf8', timeout: 20000 });
  assert.equal(result.error, undefined);
  return { ...result, value: JSON.parse(result.status === 0 ? result.stdout : result.stderr) };
}
function area(transport: string) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'bowerloom-mcp-cli-')));
  chmodSync(root, 0o700);
  const args = ['mcp', 'plan'];
  for (const kind of ['declaration', 'binding', 'catalog']) {
    const file = join(root, `${kind}.json`);
    writeFileSync(file, readFileSync(`packages/mcp-connections/test/fixtures/${transport}-${kind}.json`), { mode: 0o600 });
    args.push(`--${kind}`, file);
  }
  args.push('--synthetic');
  return { root, args };
}

for (const transport of ['stdio', 'streamable-http']) test(`MCP CLI plans ${transport} records without changing inputs or granting authority`, () => {
  const { root, args } = area(transport);
  try {
    const before = readdirSync(root).map(file => [file, readFileSync(join(root, file), 'utf8')]);
    const first = cli(...args), second = cli(...args);
    assert.equal(first.status, 0, first.stderr);
    assert.deepEqual(first.value, second.value);
    assert.equal(first.value.status, 'planning-only');
    assert.equal(first.value.contentScope, 'private-local-plan');
    assert.equal(first.value.inputEvidence, 'caller-supplied-synthetic-record');
    for (const key of ['executionAuthorized', 'writesAuthorized', 'liveDiscoveryVerified', 'authenticationVerified', 'runtimePortabilityVerified']) assert.equal(first.value[key], false);
    assert.deepEqual(first.value.grants, []);
    assert.equal(first.value.selectedTools.find((tool: { name: string }) => tool.name === 'create_draft').permissionClass, 'external-write');
    assert.deepEqual(readdirSync(root).map(file => [file, readFileSync(join(root, file), 'utf8')]), before);
    const catalogFile = join(root, 'catalog.json');
    const catalog = JSON.parse(readFileSync(catalogFile, 'utf8'));
    catalog.tools[0].inputSchema.properties.experimentId.minLength = 2;
    writeFileSync(catalogFile, JSON.stringify(catalog));
    const changed = cli(...args);
    assert.equal(changed.status, 0, changed.stderr);
    assert.notEqual(changed.value.revision, first.value.revision);
    assert.notEqual(changed.value.contentRevision, first.value.contentRevision);
    assert.notEqual(changed.value.catalogRevision, first.value.catalogRevision);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('MCP CLI rejects effects, duplicate flags, missing acknowledgment, and unsafe files without echoing inputs', () => {
  const { root, args } = area('streamable-http');
  try {
    for (const command of ['apply', 'invoke', 'connect', 'discover']) assert.equal(cli('mcp', command, ...args.slice(2)).value.error.code, 'USAGE');
    assert.equal(cli(...args.slice(0, -1)).value.error.code, 'USAGE');
    for (const tail of [['--synthetic'], ['--binding', join(root, 'binding.json')], ['--approve', 'fake']]) assert.equal(cli(...args, ...tail).value.error.code, 'USAGE');
    const file = join(root, 'binding.json');
    const binding = JSON.parse(readFileSync(file, 'utf8'));
    const marker = 'fake-token-must-not-appear-in-output';
    binding.transport.auth.token = marker;
    writeFileSync(file, JSON.stringify(binding));
    const refused = cli(...args);
    assert.notEqual(refused.status, 0);
    assert.ok(!(refused.stdout + refused.stderr).includes(marker));
    assert.ok(!(refused.stdout + refused.stderr).includes(root));
    delete binding.transport.auth.token;
    writeFileSync(file, JSON.stringify(binding));
    chmodSync(file, 0o644);
    assert.equal(cli(...args).value.error.code, 'MCP_SOURCE_UNSAFE');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
