/**
 * What a prompt's Claude Code command, or a skill's SKILL.md, can do beyond text (review M6 finding 5, and spec 06,
 * decision A on sageadvicellc/bowerloom#80): the review names it and never quotes the file.
 */
import { isScalar, parseDocument, visit } from 'yaml';
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
const ALL: readonly PromptNotice[] = ['allowed-tools', 'hooks', 'shell-lines'];
/** A key name as Claude Code might read it: case, `-` and `_` do not matter (second review M1). */
const normal = (name: string): string => name.trim().toLowerCase().replace(/[-_]/g, '');
const NOTICE_OF: Record<string, (typeof KEYS)[number]> = { allowedtools: 'allowed-tools', hooks: 'hooks' };
/**
 * The notice keys the frontmatter names, in any case, with `-` or `_` or neither, quoted or not. More notices are safe;
 * a missing one is not. Frontmatter the bounded parser cannot read (a parse error, anything but a map) fails closed and
 * names every key; an alias or a merge key anywhere returns null, which names every notice (second review M1).
 */
function frontmatterKeys(block: string): Set<(typeof KEYS)[number]> | null {
  const found = new Set<(typeof KEYS)[number]>();
  // Any line that names a key counts, so a block YAML refuses still counts.
  for (const line of block.split('\n')) { const m = /^\s*["']?([A-Za-z_-]+)["']?\s*:/.exec(line); const key = m ? NOTICE_OF[normal(m[1]!)] : undefined; if (key) found.add(key); }
  try {
    const doc = parseDocument(block, { uniqueKeys: false });
    if (doc.errors.length) throw new Error('unreadable');
    let indirect = false;
    visit(doc, { Alias: () => { indirect = true; return visit.BREAK; }, Pair: (_, pair) => { if (isScalar(pair.key) && String(pair.key.value) === '<<') { indirect = true; return visit.BREAK; } return undefined; }, Node: (_, node) => { if ((node as { anchor?: string }).anchor) { indirect = true; return visit.BREAK; } return undefined; } });
    if (indirect) return null;
    const value: unknown = doc.toJS({ maxAliasCount: 0 });
    if (value === null || value === undefined) return found;
    if (typeof value !== 'object' || Array.isArray(value)) throw new Error('unreadable');
    for (const name of Object.keys(value)) { const key = NOTICE_OF[normal(name)]; if (key) found.add(key); }
    return found;
  } catch { return new Set(KEYS); }
}
export function promptNotices(text: string): PromptNotice[] {
  const notices: PromptNotice[] = [], lines = text.split(/\r?\n/);
  // The opener and closer may carry trailing spaces, as `--- ` does in files people write.
  if (FENCE.test(lines[0] ?? '')) {
    const end = lines.findIndex((l, i) => i > 0 && FENCE.test(l));
    // Second review M1: an opener with no closer, or frontmatter with an alias or a merge key, names every notice.
    if (end < 0) return [...ALL];
    const keys = frontmatterKeys(lines.slice(1, end).join('\n'));
    if (keys === null) return [...ALL];
    for (const key of KEYS) if (keys.has(key)) notices.push(key);
  }
  // A shell command: `!` then a backquote anywhere, ```! or ~~~! anywhere, or a line whose first non-blank character is `!`.
  if (text.includes('!`') || /(?:`{3,}|~{3,})!/.test(text) || lines.some(l => l.trimStart().startsWith('!'))) notices.push('shell-lines');
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
