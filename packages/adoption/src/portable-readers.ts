/**
 * The portable parts as engines keep them (portable parts spec, sections 4.1 and 4.2): instruction files and skill
 * folders. Each place records the engines that read it.
 */
import type { EngineId } from '../../harness-definition/src/index.js';
import { place, reading, type Context } from './context.js';
import { toLf, utf8 } from './files.js';
import { textSecretRule } from './secrets.js';
import { readSkillFolder } from './skills.js';

/** The project skill folders of each engine (portable parts spec, section 4.2). */
export const SKILL_PLACES: readonly { readonly root: string; readonly engines: readonly EngineId[]; readonly owner: EngineId | null; readonly shape: string }[] = Object.freeze([
  { root: '.claude/skills', engines: ['claude-code', 'opencode'], owner: 'claude-code', shape: 'Claude Code skill folder' },
  { root: '.agents/skills', engines: ['codex', 'opencode', 'pi', 'deepseek-harness'], owner: null, shape: 'Agent Skills folder in .agents/skills' },
  { root: '.opencode/skills', engines: ['opencode'], owner: 'opencode', shape: 'OpenCode skill folder' },
  { root: '.pi/skills', engines: ['pi'], owner: 'pi', shape: 'Pi skill folder' },
  { root: '.dsh/skills', engines: ['deepseek-harness'], owner: 'deepseek-harness', shape: 'DeepSeek Harness skill folder' },
]);

const FOLLOW = /^@AGENTS\.md\s*$/;

/**
 * The instruction files (section 4.1). `AGENTS.md` is read by Codex, OpenCode, Pi, and DeepSeek Harness, and by Claude
 * Code when no `CLAUDE.md` exists. A `CLAUDE.md` that is the single line `@AGENTS.md` follows it. Any other `CLAUDE.md`
 * is read by Claude Code and DeepSeek Harness, and by OpenCode and Pi when no `AGENTS.md` exists.
 */
export function readInstructions(ctx: Context): void {
  const { r } = ctx;
  const agents = r.file('AGENTS.md', 'system-prompt');
  const claude = r.file('CLAUDE.md', 'system-prompt');
  const dotClaude = r.file('.claude/CLAUDE.md', 'system-prompt');
  const text = (rel: string, f: { bytes: Buffer } | null): string | null => {
    if (!f) return null;
    const t = utf8(f.bytes);
    if (t === null) { r.miss(rel, 'system-prompt', 'This file is not UTF-8 text with no byte order mark and no NUL.'); return null; }
    const rule = textSecretRule('instructions/AGENTS.md', f.bytes);
    if (rule) { r.miss(rel, 'system-prompt', `This file holds a value that looks like a secret (${rule}). Adoption never copies a secret value, and one inside instructions cannot be replaced with a reference safely.`); return null; }
    return t;
  };
  const a = text('AGENTS.md', agents), c = text('CLAUDE.md', claude), d = text('.claude/CLAUDE.md', dotClaude);
  const follows = c !== null && FOLLOW.test(c);
  const add = (path: string, t: string, raw: Uint8Array, engines: EngineId[], owner: EngineId | null, shape: string): void => {
    const e = reading(ctx, engines);
    if (e.length === 0) { r.miss(path, 'system-prompt', 'No engine of this harness reads this file, so it is not adopted.'); return; }
    ctx.cands.push({ part: 'system-prompt', id: 'AGENTS.md', text: toLf(t), raw, place: place(path, e, shape, owner), blocks: {}, needsApproval: [], notes: [], secrets: [] });
  };
  const claudeOwn = c !== null && !follows;
  if (a !== null) {
    add('AGENTS.md', a, agents!.bytes, ['codex', 'opencode', 'pi', 'deepseek-harness', ...(claudeOwn || d !== null ? [] : ['claude-code' as const])], null, 'AGENTS.md');
    if (follows) add('CLAUDE.md', a, agents!.bytes, ['claude-code'], 'claude-code', 'CLAUDE.md that imports AGENTS.md');
  } else if (follows) r.miss('CLAUDE.md', 'system-prompt', 'CLAUDE.md imports AGENTS.md, which does not exist, so there is nothing to adopt.');
  if (claudeOwn) add('CLAUDE.md', c, claude!.bytes, ['claude-code', 'deepseek-harness', ...(a === null ? ['opencode' as const, 'pi' as const] : [])], 'claude-code', 'CLAUDE.md');
  if (d !== null) add('.claude/CLAUDE.md', d, dotClaude!.bytes, ['claude-code'], 'claude-code', '.claude/CLAUDE.md');
  for (const [path, reason] of [
    ['CLAUDE.local.md', 'CLAUDE.local.md is local scope. Bowerloom does not adopt local scope (locked-in parts spec, decision 5).'],
    ['AGENTS.override.md', 'Codex reads AGENTS.override.md in place of AGENTS.md. The definition holds one instructions file, so a person moves its text by hand.'],
  ] as const) if (r.kind(path) !== null) { r.consumed.add(path); r.miss(path, 'system-prompt', reason); }
}

/** Every skill folder under each engine's skill path. */
export function readSkillPlaces(ctx: Context): void {
  const { r } = ctx;
  for (const sp of SKILL_PLACES) {
    const listed = r.list(sp.root, 'skills');
    if (listed === null) continue;
    r.consumed.add(sp.root);
    for (const { name, kind } of listed) {
      const rel = `${sp.root}/${name}`;
      if (name === '.DS_Store' && kind === 'file') { r.consumed.add(rel); continue; }
      if (kind === 'link') { r.consumed.add(rel); r.miss(rel, 'skills', 'This is a link. Adoption reads no link.'); continue; }
      if (kind !== 'dir') { r.consumed.add(rel); r.miss(rel, 'skills', 'A skill folder path holds only skill folders. A file here is not a skill.'); continue; }
      const engines = reading(ctx, sp.engines);
      if (engines.length === 0) { r.consumed.add(rel); r.miss(rel, 'skills', 'No engine of this harness reads this folder, so it is not adopted.'); continue; }
      const got = readSkillFolder(r, rel, place(rel, engines, sp.shape, sp.owner), engines);
      r.consumed.add(rel);
      if (got && 'skill' in got) ctx.cands.push(got.skill, ...got.rules);
    }
  }
}
