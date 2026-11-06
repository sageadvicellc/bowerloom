/**
 * Skill files: the private block of a skill written back into the engine's SKILL.md, and the meaning test that lets a
 * folder a person made be taken over when its SKILL.md holds the same values and the same body (portable parts spec,
 * section 4.2; definition spec, section 12, check 1). Pure.
 */
import { readFrontmatter } from '../../harness-definition/src/index.js';
import { toLf } from '../../harness-definition/src/json.js';
import { splitFrontmatter } from '../../context-slices/src/frontmatter.js';
import { fmKey, sameValue } from './locked-text.js';
import { sameAgentText } from './locked.js';

/**
 * The bytes of a definition SKILL.md with the keys of a private block added after its own frontmatter lines, each as
 * `key: <JSON value>`, so the core fields keep their bytes. Null when the block is not a mapping with at least one key,
 * when a key repeats a field the file holds, when the text holds a carriage return, or when the result does not read
 * back as the old fields, the new keys, and the same body. A null means the block is not written.
 */
export function projectedSkillMd(base: Uint8Array, block: unknown): Uint8Array | null {
  if (block === null || typeof block !== 'object' || Array.isArray(block)) return null;
  const entries = Object.entries(block);
  if (entries.length === 0) return null;
  const text = Buffer.from(base).toString('utf8');
  if (text.includes('\r')) return null;
  const old = readFrontmatter(text), split = splitFrontmatter(text);
  if (!old.ok || split === null) return null;
  const lines = entries.map(([k, v]) => `${fmKey(k)}: ${JSON.stringify(v)}`);
  const out = [split.head, ...(split.block === '' ? [] : [split.block]), ...lines, split.tail].join('\n');
  const now = readFrontmatter(out);
  if (!now.ok || now.body !== old.body || !sameValue(now.data, { ...old.data, ...(block as Record<string, unknown>) })) return null;
  if (Object.keys(now.data).length !== Object.keys(old.data).length + entries.length) return null;
  return Buffer.from(out);
}

/**
 * A SKILL.md a person wrote means the planned one when its frontmatter holds the same values and its body is the same
 * text. Line endings are read as LF first, as the definition reader does; key order, quoting, and comments do not
 * matter. A plain value that YAML 1.1 reads as another type does not match its quoted form (see `sameAgentText`).
 */
export function sameSkillText(held: string, planned: string): boolean {
  return sameAgentText(toLf(held), toLf(planned));
}
