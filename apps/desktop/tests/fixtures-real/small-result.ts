/** A small answer of the reader, made by the reader's own builder (shared/real/map-world.ts): two skills at home and a project with four pages of notes. Made up; no folder is read. */
import { buildRealResult } from '../../shared/real/map-world.js';
import type { PlaceRead, StampedRecord } from '../../shared/real/place.js';
import type { RealResult } from '../../shared/real/types.js';

const TALLY = { tooBig: 0, binary: 0, unreadable: 0, linksOutside: 0, brokenLinks: 0, stoppedEarly: false, truncated: false, overBytes: false, samples: { tooBig: [], binary: [], unreadable: [], linksOutside: [], brokenLinks: [] } };
const skill = (i: number): StampedRecord => ({ kind: 'skill', app: 'claude-code', name: `skill-${i}`, slug: `skill-${i}`, description: 'A skill.', relPath: `skills/s${i}/SKILL.md`, text: 'Do it.', partial: false, meta: {}, mtimeMs: 1 });

export function smallReads(): PlaceRead[] {
  const tally = TALLY as unknown as PlaceRead['tally'];
  const note = (folder: string, i: number): PlaceRead['notes'][number] => ({ rel: `${folder}/n${i}.md`, folder, title: `Note ${folder} ${i}`, summary: 'A note.', tags: [], type: 'note', bytes: 10, mtimeMs: 1 });
  return [
    { place: { id: 'place-aaaaaaaaaaaa', kind: 'home', label: 'Claude Code at home', path: '~', apps: ['claude-code'] }, records: [skill(1), skill(2)], notes: [], notesLeftOut: 0, partlyRead: 0, folders: ['.claude'], tally },
    { place: { id: 'place-bbbbbbbbbbbb', kind: 'project', label: 'alpha', path: '~/alpha', apps: [] }, records: [], notes: [note('plans', 1), note('plans', 2), note('plans', 3), note('', 4)], notesLeftOut: 0, partlyRead: 0, folders: [], tally },
  ];
}

export const smallResult = (): RealResult => buildRealResult(smallReads(), TALLY, { nowMs: 1, foldExtraApps: true });
