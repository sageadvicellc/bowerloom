// Made-up notes folders for the Memory explorer tests. Each one is written under a made-up home folder, so a test reads it through the real module scope.
// `BASIC` holds links, tags and front matter with known answers: the counts below were worked out by hand from the files, not by the code under test.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type Vault = Readonly<Record<string, string>>;

/** The files of the basic vault. A file under a hidden folder, a hidden file and a file that is not markdown are in it on purpose: none is a note. */
export const BASIC: Vault = Object.freeze({
  'Home.md': '---\ntitle: Home\ntags: [index, "area/work"]\n---\n# Home\nSee [[Project Alpha]] and [[Project Alpha|the alpha]], then [[Ideas#Later]] and [Beta](Beta.md).\nAlso [site](https://example.com/#anchor) and [[Ghost Note]]. Today is #daily.\n',
  'Project Alpha.md': '---\ntags:\n  - project\n  - area/work\n---\nBack to [[Home]]. Deep note: [[sub/Deep]]. A picture: ![[diagram.png]].\n',
  'Ideas.md': 'An idea. #idea #daily\n\n```\n[[Not A Link]] and #not-a-tag\n```\n\nInline `[[also not]]` too.\n',
  'Beta.md': '---\ntags: beta, area/work\n---\nA note with no links.\n',
  'sub/Deep.md': 'Up: [[Home]]. Twice missing: [[Missing Two]] and [[Missing Two]]. Up again: [up](../Beta.md).\n',
  '.obsidian/app.json': '{}',
  '.hidden.md': '# hidden\n[[Home]]\n',
  'readme.txt': 'not markdown',
});

/** What the basic vault holds, worked out by hand. */
export const BASIC_FACTS = Object.freeze({
  notes: 5,
  /** One link is one note and one target. Two links from a note to one target are one. An address on the web, a picture and a link inside a code block are no link. */
  links: 9,
  missingLinks: 2,
  missingTargets: ['ghost note', 'missing two'],
  tags: 6,
  tagUses: 9,
  tagNotes: { 'area/work': 3, daily: 2, index: 1, project: 1, idea: 1, beta: 1 } as Readonly<Record<string, number>>,
});

/** Writes a vault under `dir`, making each folder it needs. */
export function writeVault(dir: string, vault: Vault): string {
  for (const [rel, text] of Object.entries(vault)) {
    const file = join(dir, ...rel.split('/'));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  }
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** A vault of `count` plain notes, each linking to the next, for the caps. */
export function chain(count: number): Vault {
  const files: Record<string, string> = {};
  for (let i = 0; i < count; i += 1) files[`n${String(i).padStart(4, '0')}.md`] = `Note ${i}. Next: [[n${String(i + 1).padStart(4, '0')}]]. #t${i % 3}\n`;
  return files;
}
