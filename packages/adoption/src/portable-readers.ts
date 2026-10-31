/**
 * The portable parts as engines keep them (portable parts spec, sections 4.1 and 4.2): instruction files and skill
 * folders. Each place records the engines that read it.
 */
import fs from 'node:fs';
import { join } from 'node:path';
import type { EngineId } from '../../harness-definition/src/index.js';
import { lose, place, reading, type Context } from './context.js';
import { toLf, utf8 } from './files.js';
import { READ_BUDGET } from './files.js';
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
      if (got && 'skill' in got) { ctx.cands.push(got.skill, ...got.rules); for (const a of got.lost) for (const e of engines) lose(ctx, e, a); }
    }
  }
}

const NESTED_NAMES = new Set(['AGENTS.md', 'AGENTS.override.md', 'AGENTS.local.md', 'CLAUDE.md', 'CLAUDE.local.md']);
/** Folders the search never enters, at any depth: version control and dependencies. */
const NEVER_SEARCHED = new Set(['.git', 'node_modules']);
/** Bowerloom's own folders at the project root, which the search does not enter either. */
const ROOT_SKIPPED = new Set(['.bowerloom', '.bowerloom-skills']);

/**
 * Lists every instruction file below the project root (ruling A15). Engines load such a file on demand or not at all,
 * and the definition holds one instructions file at the root, so none is adopted. The search never enters `.git` or
 * `node_modules`, at any depth, nor Bowerloom's folders, and does not follow links. Its folder entries count toward the
 * read budget of the run; a search that stops at the budget or at the folder depth limit is listed, and needs
 * acknowledgement, so the plan is not ready until a person accepts that some files were not looked at (item C5).
 */
export function listNestedInstructions(ctx: Context): void {
  const { r } = ctx;
  let stopped = false;
  const stop = (rel: string, why: string): void => {
    if (stopped) return;
    stopped = true;
    r.miss(rel === '' ? '.' : rel, 'system-prompt', `The search for nested instruction files stopped here: ${why}. A nested AGENTS.md or CLAUDE.md past this point is not listed.`, undefined, 'acknowledge');
  };
  const walk = (rel: string, depth: number): void => {
    if (stopped) return;
    if (depth > READ_BUDGET.depth) { stop(rel, `it is more than ${READ_BUDGET.depth} folders deep`); return; }
    let names: string[];
    try { names = fs.readdirSync(rel === '' ? r.projectDir : join(r.projectDir, rel)).sort(); } catch { return; }
    if (!r.count(names.length)) { stop(rel, 'the run reached its read budget of folder entries'); return; }
    for (const name of names) {
      if (stopped) return;
      const child = rel === '' ? name : `${rel}/${name}`;
      let st: fs.Stats;
      try { st = fs.lstatSync(join(r.projectDir, child)); } catch { continue; }
      if (st.isDirectory() && !st.isSymbolicLink()) {
        if (!NEVER_SEARCHED.has(name) && !(rel === '' && ROOT_SKIPPED.has(name))) walk(child, depth + 1);
        continue;
      }
      if (rel === '' || !NESTED_NAMES.has(name) || child === '.claude/CLAUDE.md' || r.consumed.has(child)) continue;
      r.consumed.add(child);
      r.miss(child, 'system-prompt', 'A nested instruction file is not adopted: engines load it on demand or not at all, and the definition holds one instructions file at the project root. Move its text there by hand if it matters.');
    }
  };
  walk('', 0);
}
