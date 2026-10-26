// Every table that is keyed by a program has a key for each of the five (the typecheck holds that), and no program is sent to another program's file by a fall-through.
import test from 'node:test';
import assert from 'node:assert/strict';
import { placesOfItem } from '../shared/home/where-it-lives.js';
import { PROGRAM_ORDER } from '../shared/home/plain-details.js';
import type { McpTool } from '../shared/proto/types.js';

const server = (program: (typeof PROGRAM_ORDER)[number]): McpTool => ({
  id: 'tool-mcp-x', kind: 'tool', toolKind: 'mcp', name: 'x', scopeId: 'scope-global', library: null, secret: null,
  foundAt: [{ interface: program, path: 'x', contentHash: 'h', text: '{}' }],
});

test('a connection kept in a program is kept in that program\'s own folder, and Hermes and Bowerloom are not sent to the OpenCode file', () => {
  const where = Object.fromEntries(PROGRAM_ORDER.map(p => [p, placesOfItem(server(p), 'Mail connection')[0]!.path] as const));
  assert.equal(new Set(Object.values(where)).size, PROGRAM_ORDER.length, 'five programs, five different files');
  assert.match(where['hermes']!, /\.hermes\//); assert.match(where['bowerloom']!, /\.bowerloom\//);
  assert.match(where['opencode']!, /opencode\.json$/);
  assert.doesNotMatch(`${where['hermes']} ${where['bowerloom']}`, /opencode/);
});
