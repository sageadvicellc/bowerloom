// A made-up folder that the engine service can plan an adoption for. Same shape as `engineFolder` in apps/desktop/tests/helpers-engine/folders.ts: engine files only,
// with AGENTS.md and CLAUDE.md that differ, so the plan has a conflict, two approvals and one acknowledgement. Nothing in it is real.
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const json = value => `${JSON.stringify(value, null, 2)}\n`;
const put = (dir, rel, text) => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), text); };

export function engineFolder(home, name) {
  const dir = join(home, 'Projects', name);
  put(dir, 'AGENTS.md', '# Demo\n\nUse npm.\n');
  put(dir, 'CLAUDE.md', '# Demo for Claude\n\nUse pnpm.\n');
  put(dir, '.claude/skills/review/SKILL.md', '---\nname: review\ndescription: Reviews a change.\n---\n\nReview it.\n');
  put(dir, '.mcp.json', json({ mcpServers: { files: { command: 'npx', args: ['-y', 'files-server'] } } }));
  put(dir, '.claude/settings.json', json({ permissions: { deny: ['Bash(rm -rf:*)'], defaultMode: 'acceptEdits' }, hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo check' }] }] } }));
  put(dir, '.codex/config.toml', 'model = "gpt-5"\n');
  return dir;
}

/** Every file of a folder with a short hash of its bytes. Two equal answers mean nothing was written. */
export function filesOf(dir) {
  const out = {};
  const walk = rel => {
    for (const name of readdirSync(join(dir, rel)).sort()) {
      const r = rel === '' ? name : `${rel}/${name}`;
      if (lstatSync(join(dir, r)).isDirectory()) walk(r);
      else out[r] = createHash('sha256').update(readFileSync(join(dir, r))).digest('hex').slice(0, 16);
    }
  };
  walk('');
  return out;
}
