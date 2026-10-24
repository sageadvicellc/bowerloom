/** The rules of a sketch that both the window and the main process use. */
export type SketchKind = 'team' | 'agent' | 'skill' | 'prompt';

/** Which thread is allowed: a team owns helpers, and a helper uses skills and prompts. The same words the map uses. */
export const THREADS: Record<SketchKind, readonly SketchKind[]> = { team: ['agent'], agent: ['skill', 'prompt'], skill: [], prompt: [] };
export const canThread = (from: SketchKind, to: SketchKind): boolean => THREADS[from].includes(to);
/** The word for a thread, the same as the map's wire words. */
export const threadWord = (from: SketchKind): 'owns' | 'uses' => (from === 'team' ? 'owns' : 'uses');

/** The next free id: one more than the largest `sk-N` in use, so a loaded sketch never gets a duplicate. */
export function nextSketchId(used: Iterable<string>): string {
  let max = 0; const all = new Set<string>();
  for (const id of used) { all.add(id); const m = /^sk-(\d+)$/.exec(id); if (m !== null) max = Math.max(max, Number(m[1])); }
  let n = max + 1; while (all.has(`sk-${n}`)) n++;
  return `sk-${n}`;
}
