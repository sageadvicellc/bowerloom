/**
 * Skill folders (portable parts spec, section 4.2; definition spec decision 9 and lead ruling R5).
 *
 * `SKILL.md` in the definition holds the open core fields only: `name`, `description`, `license`, `compatibility`,
 * `metadata`. A skill's other frontmatter keys go to an `x-<engine>` block in `harness.json`, one for each engine that
 * reads the folder, unless the key is permission-like. `allowed-tools` becomes allow rules and `disallowed-tools` deny
 * rules (ruling R5); any other permission-like key is listed as unmapped. A skill with no valid id or description, or
 * one that holds a secret, is not adopted, with the reason.
 */
import { parseDocument } from 'yaml';
import { isId, isPermissionKey, readFrontmatter, safeName } from '../../harness-definition/src/index.js';
import type { EngineId, JsonValue } from '../../harness-definition/src/index.js';
import { splitFrontmatter } from '../../context-slices/src/frontmatter.js';
import { claudeRule, toolList } from './claude-rules.js';
import type { ProjectReader } from './files.js';
import { toLf, utf8 } from './files.js';
import type { Blocks, Candidate, Place, SkillCopy, SourceShape } from './model.js';
import { textSecretRule } from './secrets.js';

const CORE = ['name', 'description', 'license', 'compatibility', 'metadata'];
const CONTROL = /[\0-\x08\x0b-\x1f\x7f]/;
const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.trim() !== '' && [...v].length <= max && !CONTROL.test(v);

export const ALLOWED_TOOLS_APPROVAL = 'allowed-tools let the tools run only while the skill was active. As a guardrail rule the allow applies whenever the engine runs, which is wider. A person approves it, or removes the rule.';

/** A skill as read, for the planner, or null when it was listed as unmapped. `rules` come from its tool lists. */
export interface SkillRead { readonly skill: Extract<Candidate, { part: 'skills' }>; readonly rules: Candidate[] }

/**
 * Reads one skill folder. `engines` are the engines of the harness that read the place. A fixed skill (a 0.7 skill
 * already in `.bowerloom/skills`) gives back every fault as `fault` instead, since adoption cannot change it.
 */
export function readSkillFolder(
  r: ProjectReader, rel: string, place: Place, engines: readonly EngineId[], options: { fixed?: boolean; source?: SourceShape; idHint?: string } = {},
): SkillRead | { fault: string } | null {
  const fixed = options.fixed === true;
  const fault = (reason: string): { fault: string } | null => { if (fixed) return { fault: reason }; r.miss(rel, 'skills', reason); return null; };
  const before = r.unmapped.length;
  const tree = r.tree(rel, 'skills');
  // A fixed skill stays as it is, so a file the definition cannot hold makes the real folder fail to load.
  if (fixed && r.unmapped.length > before) return { fault: 'The folder holds a link, a hidden name, or a file that cannot be read safely, which a definition cannot hold.' };
  const main = tree.find(f => f.path === 'SKILL.md');
  if (!main) return fault('This skill folder has no SKILL.md that adoption can read.');
  const raw = utf8(main.file.bytes);
  if (raw === null) return fault('SKILL.md is not UTF-8 text with no byte order mark and no NUL.');
  const fm = readFrontmatter(raw);
  if (!fm.ok) return fault(`SKILL.md: ${fm.message}`);
  for (const f of tree) {
    const rule = textSecretRule(`skills/x/${f.path}`, f.file.bytes);
    if (rule) return fault(`${safeName(f.path)} holds a value that looks like a secret (${rule}). Adoption never copies a secret value, and a secret inside a skill file cannot be replaced with a reference safely.`);
  }
  const data = fm.data;
  const folder = rel.split('/').at(-1)!;
  const named = data.name;
  const id = typeof named === 'string' && isId(named) ? named : named === undefined ? (options.idHint ?? folder) : null;
  if (id === null || !isId(id)) return fault('The skill has no name that is a valid id: lowercase letters, digits, and single hyphens, up to 64 characters.');
  if (!text(data.description, 1024)) return fault('The skill has no description of 1 to 1,024 characters, which the definition needs.');

  const notes: string[] = [];
  if (named === undefined) notes.push(`SKILL.md has no name; the folder name ${id} becomes the name.`);
  else if (named !== folder) notes.push(`The folder is named after the skill name ${id}.`);
  const extra: Record<string, JsonValue> = {};
  const rules: Candidate[] = [];
  const unmappedKeys: string[] = [];
  const keep: Record<string, JsonValue> = { name: id, description: data.description as string };
  for (const [key, value] of Object.entries(data)) {
    if (key === 'name' || key === 'description') continue;
    if (key === 'license' || key === 'compatibility') { if (text(value, 500)) keep[key] = value; else extra[key] = value; continue; }
    if (key === 'metadata') {
      if (value !== null && typeof value === 'object' && !Array.isArray(value) && Object.values(value).every(v => typeof v === 'string')) keep[key] = value;
      else extra[key] = value;
      continue;
    }
    if (key === 'allowed-tools' || key === 'disallowed-tools') {
      const list = toolList(value);
      const effect = key === 'allowed-tools' ? 'allow' as const : 'deny' as const;
      if (!list) { unmappedKeys.push(key); r.miss(`${rel}/SKILL.md`, 'guardrails', `${key} is not a list of tools, so it is not adopted.`, `/${key}`); continue; }
      for (const tool of list) {
        const got = claudeRule(tool, effect);
        if ('reason' in got) { r.miss(`${rel}/SKILL.md`, 'guardrails', `A tool of ${key}: ${got.reason}`, `/${key}`); continue; }
        rules.push({
          part: 'guardrails', id: '', rule: got.rule, blocks: {}, secrets: [],
          place: { ...place, path: `${rel}/SKILL.md`, pointer: `/${key}` },
          needsApproval: effect === 'allow' ? [ALLOWED_TOOLS_APPROVAL] : [],
          notes: [effect === 'deny' ? 'disallowed-tools blocked the tool only while the skill was active. As a guardrail rule the deny applies always, which blocks more.' : `From the allowed-tools of the skill ${id}.`, ...(got.note ? [got.note] : [])],
        });
      }
      unmappedKeys.push(key);
      continue;
    }
    if (isPermissionKey(key)) { unmappedKeys.push(key); r.miss(`${rel}/SKILL.md`, 'skills', 'This key is permission-like, and a private block holds no permission-like key. It has no neutral form, so it is not adopted.', `/${key}`); continue; }
    extra[key] = value;
  }
  const blocks: Blocks = {};
  if (Object.keys(extra).length) {
    for (const e of engines) blocks[e] = extra;
    if (engines.length === 0) r.miss(`${rel}/SKILL.md`, 'skills', 'These engine-only keys have no engine of this harness that reads the folder, so they are not adopted.', '/');
  }
  if (fixed && (Object.keys(extra).length || unmappedKeys.length || named !== folder)) {
    return { fault: 'SKILL.md holds fields other than the open core fields, or a name that differs from its folder.' };
  }
  const files = tree.filter(f => f.path !== 'SKILL.md').map(f => ({ path: f.path, bytes: f.file.bytes, executable: f.file.executable }));
  const clean = named === folder && Object.keys(extra).length === 0 && unmappedKeys.length === 0;
  const copy: SkillCopy = { data: keep, body: toLf(fm.body), files, text: toLf(raw), raw: main.file.bytes, rawExecutable: main.file.executable, clean };
  return {
    skill: { part: 'skills', id, skill: copy, fixed, ...(options.source ? { source: options.source } : {}), place, blocks, needsApproval: [], notes, secrets: [] },
    rules,
  };
}

/**
 * The bytes of SKILL.md for a final id: the file as written when it holds only core fields and keeps its name, else
 * the frontmatter with every other key removed and `name` set, comments and order kept.
 */
export function skillMarkdown(copy: SkillCopy, id: string): Uint8Array {
  if (copy.clean && copy.data.name === id) return copy.raw;
  const split = splitFrontmatter(copy.text)!;
  const doc = parseDocument(split.block);
  for (const item of [...((doc.contents as { items?: { key: { value?: unknown } | string }[] })?.items ?? [])]) {
    const key = typeof item.key === 'string' ? item.key : String((item.key as { value?: unknown }).value);
    if (!CORE.includes(key) || !Object.hasOwn(copy.data, key)) doc.delete(key);
  }
  if (doc.has('name')) doc.set('name', id);
  else (doc.contents as { items: unknown[] }).items.unshift(doc.createPair('name', id));
  const block = doc.toString({ lineWidth: 0 });
  return Buffer.from(`${split.head}\n${block}${split.tail}`);
}
