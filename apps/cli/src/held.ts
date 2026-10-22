/**
 * The items `up` and `status` name as held, each with its next command (review findings 1, 2 and 16).
 * Reads only. Two sources: a created team, skill or prompt whose folder or file is gone (the authoring receipt still
 * lists it), and every skill or prompt a sync or apply plan holds.
 */
import { lstatSync } from 'node:fs';
import { join } from 'node:path';
import type { ProjectContext } from '../../../packages/project-context/src/types.js';
import { LIMITS, readGuarded, sha256 } from '../../../packages/project-authoring/src/files.js';
import { itemPath, readAuthoringState } from '../../../packages/project-authoring/src/state.js';
import type { AuthoredItem } from '../../../packages/project-authoring/src/state.js';
import { missingPromptHold } from '../../../packages/project-sync/src/prompts.js';
import type { PromptItem, SyncItem } from '../../../packages/project-sync/src/index.js';

export interface HeldItem { kind: 'team' | 'skill' | 'prompt'; id: string; code: string; next: string }

function receiptItems(project: ProjectContext): readonly AuthoredItem[] {
  try { return readAuthoringState(join(project.dir, '.bowerloom')).receipt?.value.items ?? []; } catch { return []; }
}
const gone = (path: string): boolean => { try { lstatSync(path); return false; } catch (e) { return (e as NodeJS.ErrnoException).code === 'ENOENT'; } };

/**
 * Created items whose folder or file is gone. With `team`, only that team and the skills and prompts it gets.
 * A prompt's next step is `prompt create <id>`, which restores it; a team or skill comes back from version control.
 */
export function missingItems(project: ProjectContext, team: string | null): HeldItem[] {
  const out: HeldItem[] = [];
  for (const item of receiptItems(project)) {
    if (team !== null && (item.kind === 'team' ? item.id !== team : item.teams.length > 0 && !item.teams.includes(team))) continue;
    const path = `.bowerloom/${itemPath(item.kind, item.id)}`;
    if (!gone(join(project.dir, path))) continue;
    out.push({
      kind: item.kind, id: item.id, code: 'AUTHORING_ITEM_MISSING',
      next: item.kind === 'prompt' ? missingPromptHold(item.id).next
        : `${path} is gone. Restore it from version control, for example with git restore ${path}${item.kind === 'skill' ? ', then run bowerloom skills sync' : ''}.`,
    });
  }
  return out;
}

/** The skills and prompts a sync or apply plan holds. */
export function planHolds(skills: readonly SyncItem[], prompts: readonly PromptItem[] = []): HeldItem[] {
  return [
    ...skills.filter(i => i.action === 'hold' && i.hold !== null).map(i => ({ kind: 'skill' as const, id: i.id, code: i.hold!.code, next: i.hold!.next })),
    ...prompts.filter(p => p.action === 'hold' && p.hold !== null).map(p => ({ kind: 'prompt' as const, id: p.id, code: p.hold!.code, next: p.hold!.next })),
  ];
}

/** One line per item: the first source that names an item wins. */
export function uniqueHolds(items: readonly HeldItem[]): HeldItem[] {
  const seen = new Set<string>();
  return items.filter(i => { const key = `${i.kind}\0${i.id}`; if (seen.has(key)) return false; seen.add(key); return true; });
}

/** The registered prompt files whose bytes differ from what create wrote, or null when they cannot be read safely. */
export function editedPrompts(project: ProjectContext): string[] | null {
  try {
    const items = readAuthoringState(join(project.dir, '.bowerloom')).receipt?.value.items ?? [], out: string[] = [];
    for (const item of items) {
      if (item.kind !== 'prompt') continue;
      const path = join(project.dir, '.bowerloom', itemPath('prompt', item.id));
      if (gone(path)) continue;
      const bytes = readGuarded(path, LIMITS.fileBytes), pin = item.files[0]!;
      if (sha256(bytes) !== pin.sha256 || bytes.length !== pin.bytes) out.push(`.bowerloom/${itemPath('prompt', item.id)}`);
    }
    return out;
  } catch { return null; }
}
