import test from 'node:test';
import assert from 'node:assert/strict';
import { McpConnectionError } from '../../../dist/packages/mcp-connections/src/index.js';
import { readDarwinBootSession, validBootSession } from '../../../dist/packages/mcp-connections/src/darwin-boot-session.js';

// The container guardian binds a run to the macOS boot session, and only macOS has one it reads (sysctl kern.bootsessionuuid).
// No other platform gets a reader: the guardian, its supervisor and the recovery collector refuse every other platform, so a
// boot session read on Linux would name a host that none of them accepts. These tests keep that choice explicit.

test('validBootSession accepts one upper-case UUID and nothing else', () => {
  assert.equal(validBootSession('0123ABCD-4567-89AB-CDEF-0123456789AB'), true);
  for (const bad of ['0123abcd-4567-89ab-cdef-0123456789ab', '0123ABCD-4567-89AB-CDEF-0123456789AB\n', '0123ABCD456789ABCDEF0123456789AB', '', undefined, null, 5, {}, ['0123ABCD-4567-89AB-CDEF-0123456789AB']]) {
    assert.equal(validBootSession(bad), false, String(bad));
  }
});

test('a platform other than macOS never reports a boot session: it refuses MCP_GUARDIAN_BOOT_UNKNOWN', { skip: process.platform === 'darwin' && 'macOS reads the real boot session, so it does not refuse' }, async () => {
  await assert.rejects(readDarwinBootSession(), e => e instanceof McpConnectionError && e.code === 'MCP_GUARDIAN_BOOT_UNKNOWN' && e.message === e.code);
});

test('on macOS the boot session is one valid UUID, and the same on every read', { skip: process.platform !== 'darwin' && 'needs macOS: the boot session comes from sysctl kern.bootsessionuuid' }, async () => {
  const first = await readDarwinBootSession();
  assert.equal(validBootSession(first), true, first);
  assert.equal(await readDarwinBootSession(), first);
});
