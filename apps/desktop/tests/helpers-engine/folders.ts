// Synthetic folders for the tests of the adopt and install calls. No private paths, no real rules, no real secrets.
import { chmodSync, mkdirSync, readdirSync, lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';

const json = (v: unknown): string => JSON.stringify(v, null, 2) + '\n';
const put = (dir: string, rel: string, text: string): void => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), text); };

/** A folder set up the old way: engine files only. Adoption finds a conflict (AGENTS.md and CLAUDE.md differ), two approvals and one acknowledgement. */
export function engineFolder(home: string, name = 'adopt-me'): string {
  const dir = join(home, 'Projects', name);
  put(dir, 'AGENTS.md', '# Demo\n\nUse npm.\n');
  put(dir, 'CLAUDE.md', '# Demo for Claude\n\nUse pnpm.\n');
  put(dir, '.claude/skills/review/SKILL.md', '---\nname: review\ndescription: Reviews a change.\n---\n\nReview it.\n');
  put(dir, '.mcp.json', json({ mcpServers: { files: { command: 'npx', args: ['-y', 'files-server'] } } }));
  put(dir, '.claude/settings.json', json({ permissions: { deny: ['Bash(rm -rf:*)'], defaultMode: 'acceptEdits' }, hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo check' }] }] } }));
  put(dir, '.codex/config.toml', 'model = "gpt-5"\n');
  return dir;
}

/**
 * A folder with a 0.8 definition for Claude Code and Codex, and its own CLAUDE.md that does not follow AGENTS.md. Its guardrail and hook are enforced and
 * weakened in Codex, so the plan asks for two approvals first. Its server reads ${HOME}, so Codex leaves it out.
 */
export function definedFolder(home: string, name = 'defined'): string {
  const dir = join(home, 'Projects', name);
  put(dir, 'CLAUDE.md', '# Demo for Claude\n\nUse pnpm.\n');
  put(dir, '.bowerloom/harness.json', json({ format: 'bowerloom/harness/v1beta1', id: 'demo', description: 'A demo harness.', engines: [{ id: 'claude-code' }, { id: 'codex' }], parts: { 'system-prompt': 'instructions/AGENTS.md', skills: 'skills/', guardrails: 'guardrails.json', hooks: 'hooks.json', mcp: 'mcp.json' } }));
  put(dir, '.bowerloom/instructions/AGENTS.md', '# Demo\n\nUse npm.\n');
  put(dir, '.bowerloom/skills/review/SKILL.md', '---\nname: review\ndescription: Reviews a change.\n---\n\nReview it.\n');
  put(dir, '.bowerloom/guardrails.json', json({ rules: [{ id: 'no-force-push', action: 'shell', pattern: 'git push --force *', effect: 'deny', strength: 'enforced' }] }));
  put(dir, '.bowerloom/hooks.json', json({ hooks: [{ id: 'check-bash', event: 'PreToolUse', matcher: 'Bash', command: 'echo check', strength: 'enforced' }] }));
  put(dir, '.bowerloom/mcp.json', json({ servers: [{ name: 'files', transport: 'stdio', command: 'npx', args: ['-y', 'files-server'], env: { ROOT: '${HOME}' } }] }));
  return dir;
}

/**
 * A folder with a 0.8 definition that has agents: `writer` uses the skill `review`, `reader` uses none, and the skill `outline` is used by no agent. Only
 * instructions, skills and agents, for Claude Code and Codex, so a save and an install have nothing to approve.
 */
export function teamFolder(home: string, name = 'team'): string {
  const dir = join(home, 'Projects', name);
  put(dir, '.bowerloom/harness.json', json({ format: 'bowerloom/harness/v1beta1', id: name, description: 'A team harness.', engines: [{ id: 'claude-code', version: '2.1.310' }, { id: 'codex' }], parts: { 'system-prompt': 'instructions/AGENTS.md', skills: 'skills/', subagents: 'agents/' } }));
  put(dir, '.bowerloom/instructions/AGENTS.md', '# Team\n\nUse npm.\n');
  put(dir, '.bowerloom/skills/review/SKILL.md', '---\nname: review\ndescription: Reviews a change.\n---\n\nReview it.\n');
  put(dir, '.bowerloom/skills/outline/SKILL.md', '---\nname: outline\ndescription: Outlines a draft.\n---\n\nOutline it.\n');
  put(dir, '.bowerloom/agents/writer.md', '---\nname: writer\ndescription: Writes the draft.\nskills:\n  - review\n---\n\nWrite the draft.\n');
  put(dir, '.bowerloom/agents/reader.md', '---\nname: reader\ndescription: Reads the sources.\n---\n\nRead the sources.\n');
  return dir;
}

/** A folder with a skill `summarize` of two files, one of them a script, to copy into another folder's harness. */
export function sourceFolder(home: string, name = 'source'): string {
  const dir = join(home, 'Projects', name);
  put(dir, '.bowerloom/harness.json', json({ format: 'bowerloom/harness/v1beta1', id: name, description: 'A source harness.', engines: [{ id: 'claude-code' }], parts: { skills: 'skills/' } }));
  put(dir, '.bowerloom/skills/summarize/SKILL.md', '---\nname: summarize\ndescription: Summarizes a page.\n---\n\nRun scripts/count.sh, then summarize.\n');
  put(dir, '.bowerloom/skills/summarize/scripts/count.sh', '#!/bin/sh\nwc -w "$1"\n');
  chmodSync(join(dir, '.bowerloom/skills/summarize/scripts/count.sh'), 0o755);
  return dir;
}

/** A home folder for a test: private, with no tool folders. */
export function homeFolder(base: string): string {
  const home = join(base, 'home');
  mkdirSync(home, { recursive: true }); chmodSync(home, 0o700);
  return home;
}

/** Every file of a folder with the hash of its bytes, `.bowerloom` included. */
export function filesOf(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (rel: string): void => {
    for (const name of readdirSync(join(dir, rel)).sort()) {
      const r = rel === '' ? name : `${rel}/${name}`, st = lstatSync(join(dir, r));
      if (st.isDirectory()) walk(r); else out[r] = createHash('sha256').update(readFileSync(join(dir, r))).digest('hex').slice(0, 16);
    }
  };
  walk('');
  return out;
}
