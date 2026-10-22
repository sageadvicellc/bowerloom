/**
 * What a prompt's Claude Code command, or a skill's SKILL.md, can do beyond text (review M6 finding 5, and spec 06,
 * decision A on sageadvicellc/bowerloom#80): the review names it and never quotes the file.
 */
import { parseDocument } from 'yaml';
import { skillHead } from '../../skill-manifest/src/content.js';

/**
 * What a Claude Code command can do beyond text (review M6 finding 5): `allowed-tools` in its frontmatter grants tools,
 * `hooks` registers hooks that keep running for the rest of the session, and `!` then a backquote, a line that starts
 * with `!`, or a fence opened with ```! runs shell commands when the command is used (Claude Code skills docs,
 * Frontmatter reference). The review names them; it never quotes the prompt.
 */
export type PromptNotice = 'allowed-tools' | 'hooks' | 'shell-lines';
const FENCE = /^---[ \t]*$/;
const KEYS = ['allowed-tools', 'hooks'] as const;
/**
 * The notice keys the frontmatter names, in any case, quoted or not. More notices are safe; a missing one is not, so
 * frontmatter the bounded parser cannot read (an alias, a merge key, a parse error, anything but a map) fails closed
 * and names every key (F' security review finding 1).
 */
function frontmatterKeys(block: string): Set<(typeof KEYS)[number]> {
  const found = new Set<(typeof KEYS)[number]>();
  // Any line that names a key counts, so a block YAML refuses still counts.
  for (const key of KEYS) if (block.split('\n').some(l => new RegExp(`^\\s*["']?${key}["']?\\s*:`, 'i').test(l))) found.add(key);
  try {
    const doc = parseDocument(block, { uniqueKeys: false });
    if (doc.errors.length) throw new Error('unreadable');
    const value: unknown = doc.toJS({ maxAliasCount: 0 });
    if (value === null || value === undefined) return found;
    if (typeof value !== 'object' || Array.isArray(value)) throw new Error('unreadable');
    for (const name of Object.keys(value)) { const k = name.trim().toLowerCase(); for (const key of KEYS) if (k === key) found.add(key); }
    return found;
  } catch { return new Set(KEYS); }
}
export function promptNotices(text: string): PromptNotice[] {
  const notices: PromptNotice[] = [], lines = text.split(/\r?\n/);
  // The opener and closer may carry trailing spaces, as `--- ` does in files people write.
  if (FENCE.test(lines[0] ?? '')) {
    const end = lines.findIndex((l, i) => i > 0 && FENCE.test(l));
    if (end > 0) { const keys = frontmatterKeys(lines.slice(1, end).join('\n')); for (const key of KEYS) if (keys.has(key)) notices.push(key); }
  }
  // A shell command: `!` then a backquote anywhere, a line that starts with `!`, or a code fence opened with ```!.
  if (text.includes('!`') || lines.some(l => l.startsWith('!') || /^[ \t]*(?:`{3,}|~{3,})!/.test(l))) notices.push('shell-lines');
  return notices;
}

/**
 * The `allowed-tools` a SKILL.md declares, as the plan shows it, or undefined when it declares none. Fail closed: a
 * frontmatter that names the key but cannot be read counts as declaring it.
 */
export function declaredAllowedTools(text: string): string | undefined {
  if (!promptNotices(text).includes('allowed-tools')) return undefined;
  try { return skillHead(text).allowedTools ?? 'declared, but its value cannot be read'; } catch { return 'declared, but its value cannot be read'; }
}
