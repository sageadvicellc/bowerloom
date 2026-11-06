/**
 * The notes section (0.8 spec, section 6.9; harness definition spec, section 5.1). When an agent lists knowledge sources
 * in `notes`, projection adds one short section at the end of its instructions. The section names each source and its
 * path, and says to read the `AGENTS.md` file at its root first. It is fixed text: no page map, and no read rule.
 * Nothing limits which pages the agent reads. Bowerloom never opens the source folder.
 *
 * The stored path is safe to quote: the loader allows no backtick, backslash, or control character in it, and a name is
 * an id. A relative path is relative to the harness folder, where the engine runs.
 */
import type { KnowledgeSource, SubagentEntry } from '../../harness-definition/src/index.js';

export const NOTES_HEADING = '## Notes' as const;

const shown = (path: string): { readonly folder: string; readonly agents: string } =>
  path === '.' ? { folder: './', agents: './AGENTS.md' } : { folder: path, agents: `${path}/AGENTS.md` };

/** The notes section for these sources, in the order given, ending in a newline. Empty for no source. */
export function notesSection(sources: readonly KnowledgeSource[]): string {
  if (sources.length === 0) return '';
  const lines = sources.map(s => {
    const { folder, agents } = shown(s.path);
    return `- ${s.name}: the wiki folder at \`${folder}\`. Read \`${agents}\` first.`;
  });
  return `${NOTES_HEADING}\n\n${lines.join('\n')}\n`;
}

/**
 * The subagents with the notes section added to the body of each one that lists a source. An agent that lists none is
 * returned as it is, so its projection stays byte-identical. A name with no source is a loader fault and is skipped here.
 */
export function withNotesSections(subagents: readonly SubagentEntry[], knowledge: readonly KnowledgeSource[]): SubagentEntry[] {
  const byName = new Map(knowledge.map(k => [k.name, k]));
  return subagents.map(a => {
    const sources = (a.notes ?? []).flatMap(n => byName.get(n) ?? []);
    if (sources.length === 0) return a;
    const body = a.body.endsWith('\n') || a.body === '' ? a.body : `${a.body}\n`;
    return { ...a, body: `${body}\n${notesSection(sources)}` };
  });
}
