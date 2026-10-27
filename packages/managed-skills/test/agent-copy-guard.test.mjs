// Spec 05, section 10.9: the guard entry in the Claude Code copy of an agent.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from 'yaml';
import { claudeCopyBytes, guardConflict } from '../../../dist/packages/managed-skills/src/agent-copy.js';

const BODY = 'Do the work.\n\nLine two with `code` and a ---\n';
const src = (front, body = BODY) => `---\n${front}\n---\n${body}`;
const PLAIN = src('name: lead\ndescription: Leads the desk.');
const G = { role: 'lead', slices: ['wiki', 'zeta'], roots: ['wiki:' + 'a'.repeat(32), 'zeta:' + 'b'.repeat(32)], projectDir: '/Users/me/Project', projectId: 'c'.repeat(32) };
const front = text => parse(text.split('\n---\n')[0].replace(/^---\n/, ''));
const ENTRY = g => ({ matcher: 'Read|Grep|Glob', hooks: [{ type: 'command', command: 'bowerloom-guard', args: ['--agent', g.role, '--project', g.projectDir, '--project-id', g.projectId, ...g.slices.flatMap(s => ['--slice', s]), ...g.roots.flatMap(r => ['--root', r])], timeout: 10, onFailure: 'block' }] });

test('1. claudeCopyBytes(source, { guard: null }) returns the source', () => { assert.equal(claudeCopyBytes(PLAIN, { guard: null }), PLAIN); });
test('2. a source without hooks gains the guard entry; it parses and every other key is equal', () => {
  const out = claudeCopyBytes(PLAIN, { guard: G }), a = front(PLAIN), b = front(out);
  assert.deepEqual({ ...b, hooks: undefined }, { ...a, hooks: undefined }); assert.deepEqual(b.hooks, { PreToolUse: [ENTRY(G)] });
  assert.deepEqual(Object.keys(b), ['name', 'description', 'hooks'], 'the new key goes last');
});
test('3. a source with hooks.PreToolUse keeps its entries and gains the guard entry last', () => {
  const own = src('name: lead\ndescription: Leads.\nhooks:\n  PreToolUse:\n    - matcher: Bash\n      hooks:\n        - type: command\n          command: ./check.sh\n  PostToolUse:\n    - matcher: Edit\n      hooks:\n        - type: command\n          command: ./fmt.sh\ntools: Read, Grep');
  const out = claudeCopyBytes(own, { guard: G }), b = front(out), a = front(own);
  assert.equal(b.hooks.PreToolUse.length, 2); assert.deepEqual(b.hooks.PreToolUse[0], a.hooks.PreToolUse[0]); assert.deepEqual(b.hooks.PreToolUse[1], ENTRY(G));
  assert.deepEqual(b.hooks.PostToolUse, a.hooks.PostToolUse); assert.equal(b.tools, 'Read, Grep'); assert.deepEqual(Object.keys(b), Object.keys(a));
  // Hooks without PreToolUse gains the list at the end of the hooks map.
  const post = src('name: lead\ndescription: Leads.\nhooks:\n  PostToolUse: []'), c = front(claudeCopyBytes(post, { guard: G }));
  assert.deepEqual(c.hooks, { PostToolUse: [], PreToolUse: [ENTRY(G)] });
});
test('4. a source with a comment in its frontmatter keeps the comment', () => {
  const text = src('# The lead of the desk\nname: lead # inline\ndescription: Leads.\n\n# Tools below\ntools: Read');
  const out = claudeCopyBytes(text, { guard: G });
  for (const part of ['# The lead of the desk', '# inline', '# Tools below']) assert.ok(out.includes(part), part);
});
test('5. the body bytes after the closing fence are unchanged', () => {
  const crlf = src('name: lead\ndescription: Leads.', 'Line\r\nTwo\r\n\r\n\ttabbed\n---\nno trailing newline');
  const out = claudeCopyBytes(crlf, { guard: G });
  assert.ok(out.endsWith('\n---\nLine\r\nTwo\r\n\r\n\ttabbed\n---\nno trailing newline')); assert.ok(out.startsWith('---\nname: lead\n'));
  const spaced = '---  \nname: lead\ndescription: Leads.\n---\t\nBody\n'; assert.ok(claudeCopyBytes(spaced, { guard: G }).startsWith('---  \n') && claudeCopyBytes(spaced, { guard: G }).includes('\n---\t\nBody\n'));
});
test('6. the output is the same for the same input', () => { assert.equal(claudeCopyBytes(PLAIN, { guard: G }), claudeCopyBytes(PLAIN, { guard: { ...G } })); });
test('7. guardConflict is true for hooks: [], and claudeCopyBytes then throws MANAGED_SKILL_REFUSED', () => {
  const bad = src('name: lead\ndescription: Leads.\nhooks: []'); assert.equal(guardConflict(bad), true);
  assert.throws(() => claudeCopyBytes(bad, { guard: G }), e => e.code === 'MANAGED_SKILL_REFUSED');
  assert.equal(guardConflict(src('name: lead\ndescription: d\nhooks:\n  PreToolUse: x')), true); assert.equal(guardConflict(src('name: lead\ndescription: d\nhooks:\n  PreToolUse: []')), false);
  assert.equal(guardConflict(PLAIN), false); assert.equal(guardConflict('not frontmatter'), false); assert.equal(guardConflict(src('a: [unclosed')), false);
  assert.equal(guardConflict(src('name: lead\ndescription: d\nhooks:\n  PostToolUse: []')), false);
  assert.equal(claudeCopyBytes(bad, { guard: null }), bad, 'with no guard the conflict is not looked at');
});
test('8. the args list the project path, the project id, and the slices in sorted order', () => {
  const args = front(claudeCopyBytes(PLAIN, { guard: G })).hooks.PreToolUse[0].hooks[0].args;
  assert.deepEqual(args, ['--agent', 'lead', '--project', '/Users/me/Project', '--project-id', 'c'.repeat(32), '--slice', 'wiki', '--slice', 'zeta', '--root', 'wiki:' + 'a'.repeat(32), '--root', 'zeta:' + 'b'.repeat(32)]);
  const none = front(claudeCopyBytes(PLAIN, { guard: { ...G, slices: ['wiki'], roots: [] } })).hooks.PreToolUse[0].hooks[0].args; assert.equal(none.includes('--root'), false);
});
test('9. golden text for the two cases of section 4.6', () => {
  const g = { role: 'lead', slices: ['wiki'], roots: ['wiki:' + 'a'.repeat(32)], projectDir: '/Users/me/Project', projectId: 'c'.repeat(32) };
  const entry = `    - matcher: Read|Grep|Glob
      hooks:
        - type: command
          command: bowerloom-guard
          args:
            - "--agent"
            - "lead"
            - "--project"
            - "/Users/me/Project"
            - "--project-id"
            - "${'c'.repeat(32)}"
            - "--slice"
            - "wiki"
            - "--root"
            - "wiki:${'a'.repeat(32)}"
          timeout: 10
          onFailure: block
`;
  assert.equal(claudeCopyBytes(PLAIN, { guard: g }), `---\nname: lead\ndescription: Leads the desk.\nhooks:\n  PreToolUse:\n${entry}---\n${BODY}`);
  const own = src('name: lead\ndescription: Leads the desk.\nhooks:\n  PreToolUse:\n    - matcher: Bash\n      hooks:\n        - type: command\n          command: ./check.sh');
  assert.equal(claudeCopyBytes(own, { guard: g }), `---\nname: lead\ndescription: Leads the desk.\nhooks:\n  PreToolUse:\n    - matcher: Bash\n      hooks:\n        - type: command\n          command: ./check.sh\n${entry}---\n${BODY}`);
});
test('10. every args element is a double-quoted scalar, including a path with a space and a quote', () => {
  const g = { ...G, projectDir: "/Users/me/My Project's # folder", slices: ['wiki'], roots: [] };
  const out = claudeCopyBytes(PLAIN, { guard: g }), args = front(out).hooks.PreToolUse[0].hooks[0].args;
  assert.equal(args[3], "/Users/me/My Project's # folder");
  const lines = out.split('\n'), at = lines.indexOf('          args:'); const list = lines.slice(at + 1, lines.indexOf('          timeout: 10'));
  assert.ok(list.length >= 8); for (const line of list) assert.match(line, /^ {12}- ".*"$/, line);
  const hard = { ...G, projectDir: '/tmp/a"b\\cé', slices: ['wiki'], roots: [] }; assert.equal(front(claudeCopyBytes(PLAIN, { guard: hard })).hooks.PreToolUse[0].hooks[0].args[3], '/tmp/a"b\\cé');
});
test('a long project path is never folded', () => {
  const long = '/Users/me/' + 'x'.repeat(300), out = claudeCopyBytes(PLAIN, { guard: { ...G, projectDir: long, slices: ['wiki'], roots: [] } });
  assert.ok(out.includes(`"${long}"`)); assert.equal(front(out).hooks.PreToolUse[0].hooks[0].args[3], long);
});
