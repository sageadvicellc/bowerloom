/**
 * A made-up home folder that looks like a lived-in developer machine: a Claude Code folder with scratch space 7 folders deep, and a Codex folder with plug-in clones, work-folder
 * copies, a broken link and a skill with deep support folders. Every name and text is invented. The folders the reader must never enter are locked (mode 000) and hold a marker
 * text: if the reader lists or opens one, the folder cannot be opened and the count of things that could not be opened is not zero, and if it reads one, the marker shows in the result.
 */
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/** A text that only a file outside the allowlist holds. It must never show in a result. */
export const OUTSIDE_MARKER = 'OUTSIDE-THE-ALLOWLIST-MARKER-4417';

export interface ToolHomes {
  readonly root: string;
  readonly home: string;
  /** Folders locked with mode 000, outside the allowlist. Unlocked by `cleanup`. */
  readonly locked: readonly string[];
  readonly cleanup: () => void;
}

const put = (file: string, text: string): void => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); };
const skillText = (name: string): string => `---\nname: ${name}\ndescription: A skill of the tool home test.\n---\n\nDo the thing.\n`;
const agentText = (name: string): string => `---\nname: ${name}\ndescription: An agent of the tool home test.\n---\n\nHelp.\n`;
const DEEP = ['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'd8', 'd9'];

/** How many files the scratch space of the Claude Code folder holds. */
export const SCRATCH_FILES = 300;

/** For tests only: a hook that runs just before each folder is locked, so a test can make the build fail midway. */
export interface BuildOptions { readonly beforeLock?: (dir: string, index: number) => void }

export function buildToolHomes(options: BuildOptions = {}): ToolHomes {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'bowerloom-tool-homes-')));
  const locked: string[] = [];
  // Built first, before anything is locked: it unlocks what is locked so far, removes the tree and drops its exit hook. A run that is killed restores the permissions too.
  let done = false;
  const cleanup = (): void => {
    process.removeListener('exit', cleanup);
    if (done) return;
    done = true;
    for (const dir of locked) { try { chmodSync(dir, 0o755); } catch { /* already gone */ } }
    rmSync(root, { recursive: true, force: true });
  };
  process.on('exit', cleanup);
  try {
    return build(root, locked, cleanup, options);
  } catch (error) {
    cleanup();
    throw error;
  }
}

function build(root: string, locked: string[], cleanup: () => void, options: BuildOptions): ToolHomes {
  const home = join(root, 'home');
  mkdirSync(home, { recursive: true });

  // Claude Code: real content, and scratch space (jobs/<id>/tmp, 7 folders deep, 300 files) that a skill or an agent file name would match if the reader went in.
  const claude = join(home, '.claude');
  put(join(claude, 'agents', 'a.md'), agentText('agent-a'));
  put(join(claude, 'skills', 's', 'SKILL.md'), skillText('skill-s'));
  put(join(claude, 'commands', 'go.md'), '---\ndescription: Go.\n---\nGo.\n');
  put(join(claude, 'settings.json'), JSON.stringify({ permissions: { allow: [] } }));
  put(join(claude, 'history.jsonl'), `{"text":"${OUTSIDE_MARKER}"}\n`);
  for (let i = 0; i < SCRATCH_FILES; i += 1) {
    const folder = join(claude, 'jobs', 'abc', 'tmp', ...DEEP.slice(0, 4 + (i % 3)));
    put(join(folder, `scratch-${i}.md`), `${OUTSIDE_MARKER}\n`);
    put(join(folder, 'SKILL.md'), skillText(`scratch ${OUTSIDE_MARKER}`));
  }
  put(join(claude, 'jobs', 'abc', 'tmp', 'd1', 'agents', 'trap.md'), agentText(`trap ${OUTSIDE_MARKER}`));
  locked.push(join(claude, 'jobs'));
  locked.push(join(claude, 'projects'));
  put(join(claude, 'projects', 'p', 's.jsonl'), OUTSIDE_MARKER);

  // Codex: plug-in clones, work-folder copies and packages (all outside the allowlist), a broken link, a real agent, a skill with deep support folders.
  const codex = join(home, '.codex');
  put(join(codex, 'config.toml'), 'model = "m"\n');
  put(join(codex, 'agents', 'ok.toml'), 'name = "ok"\ndescription = "A real agent."\ndeveloper_instructions = """\nHelp.\n"""\n');
  symlinkSync(join(codex, 'agents', 'gone', 'x.toml'), join(codex, 'agents', 'x.toml'));
  put(join(codex, 'prompts', 'p.md'), 'Run the checks.\n');
  put(join(codex, 'skills', 'k', 'SKILL.md'), skillText('skill-k'));
  put(join(codex, 'skills', 'k', 'references', ...DEEP, 'note.md'), '# A reference\n\nDeep inside the skill.\n');
  put(join(codex, 'skills', 'k', 'assets', ...DEEP, 'SKILL.md'), skillText('skill-k-asset'));
  put(join(codex, '.tmp', 'marketplaces', 'x', 'plugins', 'y', 'skills', 'z', 'SKILL.md'), skillText(`clone ${OUTSIDE_MARKER}`));
  put(join(codex, 'worktrees', 'w', '.claude', 'skills', 'ww', 'SKILL.md'), skillText(`worktree ${OUTSIDE_MARKER}`));
  put(join(codex, 'worktrees', 'w', 'docs', ...DEEP, 'note.md'), OUTSIDE_MARKER);
  put(join(codex, 'packages', 'pkg', 'agents', 'p.toml'), `name = "p ${OUTSIDE_MARKER}"\n`);
  put(join(codex, 'sessions', '2026', 's.jsonl'), OUTSIDE_MARKER);
  locked.push(join(codex, '.tmp'), join(codex, 'worktrees'), join(codex, 'packages'));

  // Lock them last: only the top of each is locked.
  locked.forEach((dir, index) => { options.beforeLock?.(dir, index); chmodSync(dir, 0o000); });
  return { root, home, locked, cleanup };
}
