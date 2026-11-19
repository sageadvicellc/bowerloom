// Generated scan fixtures for the payload baseline.
// The repository holds no large realistic input for the scan: its one made-up home (apps/desktop/tools/made-up-home.ts) is a few kilobytes. So the biggest scan result
// is found by making a folder whose size follows the reader's own limits (apps/desktop/shared/real/types.ts, REAL_LIMITS):
//   - 200 places per session: the picked folder is one, so at most 199 project folders below it;
//   - 10,000 files per call (itemsPerCall), 20 MiB read per call (totalBytes), 2 MiB per file;
//   - 4,000,000 characters of text go whole to the page, and every text after that is cut to 1,000 (resultTextChars, minExcerptChars).
// Each shape stays inside those limits and fills a different one. The shape with the largest serialized result is the baseline.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** The shapes measured. Each one projects x skills x fileBytes stays at or under 20 MiB, and at or under 10,000 files. `baseline` marks the largest one, as measured. */
export const SHAPES = Object.freeze([
  Object.freeze({ name: 'many-small', projects: 199, skills: 50, fileBytes: 2000, baseline: true, why: 'fills the 10,000-file limit with files of 2 KB, so nearly all of the 20 MiB read limit is used' }),
  Object.freeze({ name: 'balanced', projects: 199, skills: 25, fileBytes: 4000, why: 'half the files, twice the size' }),
  Object.freeze({ name: 'few-large', projects: 100, skills: 10, fileBytes: 20000, why: 'fills the 20,000-character whole-text limit of each file, with 1,000 files' }),
]);

const WORDS = ['read', 'the', 'file', 'then', 'list', 'each', 'change', 'before', 'review', 'a', 'draft', 'note', 'check', 'owner', 'task', 'step', 'plan', 'folder', 'name', 'result', 'compare', 'with', 'last', 'week', 'and', 'write', 'one', 'line'];
const pad = (n, width = 3) => String(n).padStart(width, '0');

/** Plain prose made from a fixed word list, from a seed. The same seed gives the same text. */
function prose(seed, bytes) {
  let state = (seed * 2654435761) >>> 0;
  const out = [];
  let length = 0;
  while (length < bytes) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const word = WORDS[state % WORDS.length];
    out.push(word);
    length += word.length + 1;
  }
  return out.join(' ');
}

/** The text of one skill file: front matter and a body, cut to exactly `fileBytes` bytes (ASCII only). */
function skillText(project, skill, fileBytes) {
  const head = `---\nname: skill-${pad(skill)}\ndescription: Skill ${pad(skill)} of project ${pad(project)}, made up for a size test.\n---\n\n`;
  const body = prose(project * 1000 + skill, Math.max(0, fileBytes - head.length) + 20);
  return `${head}${body}`.slice(0, fileBytes).padEnd(fileBytes, '.');
}

/**
 * Makes `<root>/home` (empty, with no tool folders) and `<root>/picked` with `projects` project folders. Each project has `.claude/skills/skill-NNN/SKILL.md` for `skills` skills.
 * Returns the folders and the counts. No name, text or path in it is real.
 */
export function makeScanFixture(root, { projects, skills, fileBytes }) {
  const home = join(root, 'home');
  const picked = join(root, 'picked');
  mkdirSync(home, { recursive: true });
  mkdirSync(picked, { recursive: true });
  for (let p = 1; p <= projects; p += 1) {
    for (let s = 1; s <= skills; s += 1) {
      const dir = join(picked, `project-${pad(p)}`, '.claude', 'skills', `skill-${pad(s)}`);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'SKILL.md'), skillText(p, s, fileBytes));
    }
  }
  return { home, picked, projects, skillFiles: projects * skills };
}
