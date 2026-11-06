/**
 * The made-up project that the landing page shots show. Every name is invented and neutral: a weekly report crew with agents, skills, a hook, and a server.
 * It uses only node: modules and syntax that Node can run as it is, so the command line shot builds the same folder.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const put = (dir: string, rel: string, text: string): void => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), text); };
const json = (value: unknown): string => JSON.stringify(value, null, 2) + '\n';

const SKILLS: Record<string, string> = {
  outline: 'Outlines the report before it is written.',
  summarize: 'Summarizes one page of notes.',
  proofread: 'Checks spelling and tone.',
};
const AGENTS: Record<string, { description: string; skills: string[] }> = {
  drafter: { description: 'Writes the first draft of the report.', skills: ['outline'] },
  checker: { description: 'Checks the draft before it goes out.', skills: [] },
};

export interface WeeklyOptions {
  /** A hook that Codex carries more weakly than the harness says, so the install asks before it writes. Default true. */
  hook?: boolean;
  /** The servers to write. A `'plain'` server Codex carries in its own file, and a `'home'` server reads ${HOME}, so Codex leaves it out. Default: one plain server. */
  servers?: ('plain' | 'home')[];
  /** The skills to write. Default: all three. */
  skills?: string[];
  /** The agents to write. Default: both. An agent keeps only the skills that are written. */
  agents?: string[];
}

/** The folder `<home>/Projects/<name>`: a harness for Claude Code and Codex. */
export function weeklyFolder(home: string, name = 'weekly', { hook = true, servers = ['plain'], skills = Object.keys(SKILLS), agents = Object.keys(AGENTS) }: WeeklyOptions = {}): string {
  const dir = join(home, 'Projects', name);
  put(dir, '.bowerloom/harness.json', json({
    format: 'bowerloom/harness/v1beta1', id: name, description: 'Writes the weekly report from the team notes.',
    engines: [{ id: 'claude-code' }, { id: 'codex' }],
    parts: {
      'system-prompt': 'instructions/AGENTS.md',
      ...(skills.length > 0 ? { skills: 'skills/' } : {}),
      ...(agents.length > 0 ? { subagents: 'agents/' } : {}),
      ...(hook ? { hooks: 'hooks.json' } : {}),
      ...(servers.length > 0 ? { mcp: 'mcp.json' } : {}),
    },
  }));
  put(dir, '.bowerloom/instructions/AGENTS.md', '# Weekly report\n\nWrite the report from the notes in `notes/`. Keep it to one page.\n');
  for (const id of skills) put(dir, `.bowerloom/skills/${id}/SKILL.md`, `---\nname: ${id}\ndescription: ${SKILLS[id]}\n---\n\n${SKILLS[id]}\n`);
  for (const id of agents) {
    const agent = AGENTS[id]!, linked = agent.skills.filter(s => skills.includes(s));
    put(dir, `.bowerloom/agents/${id}.md`, `---\nname: ${id}\ndescription: ${agent.description}\n${linked.length > 0 ? `skills:\n${linked.map(s => `  - ${s}`).join('\n')}\n` : ''}---\n\n${agent.description}\n`);
  }
  if (hook) put(dir, '.bowerloom/hooks.json', json({ hooks: [{ id: 'check-bash', event: 'PreToolUse', matcher: 'Bash', command: 'echo check', strength: 'enforced' }] }));
  if (servers.length > 0) {
    const entry = (kind: 'plain' | 'home') => kind === 'home'
      ? { name: 'notes-index', transport: 'stdio', command: 'npx', args: ['-y', 'notes-index-server'], env: { NOTES_ROOT: '${HOME}' } }
      : { name: 'notes-files', transport: 'stdio', command: 'npx', args: ['-y', 'notes-files-server'] };
    put(dir, '.bowerloom/mcp.json', json({ servers: servers.map(entry) }));
  }
  return dir;
}

// Run as a script: node --experimental-strip-types landing-shots-fixture.ts <home> [plain]
if (process.argv[1]?.endsWith('landing-shots-fixture.ts') && process.argv[2] !== undefined) console.log(weeklyFolder(process.argv[2], 'weekly', process.argv[3] === 'plain' ? { hook: false, servers: [] } : {}));
