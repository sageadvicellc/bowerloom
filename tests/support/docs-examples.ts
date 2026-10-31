// The examples of the docs page "Where your items come from" (spec 10 of beta.3, section 3.5), built with the real
// serializers so the page never shows a file that Bowerloom would refuse. Not a test file, and not part of the product.
//
// The pinned skill is the npm entry of the skill-manifest test fixture (packages/skill-manifest/test/support/expected.mjs),
// a synthetic package, under the id tanstack-db and tagged to the store team research. The written items are fixed texts
// whose hashes are computed here. The commit and the tree are fixed 40-hex ids, and the remote is an example repository.
import { createHash } from 'node:crypto';
import { serializeConfig, serializeLock, CONFIG_FORMAT, LOCK_FORMAT } from '../../packages/project-config/src/index.js';
import type { LockItem, ProjectConfig, ProjectLock } from '../../packages/project-config/src/index.js';
import { validateEntry } from '../../packages/skill-manifest/src/schema.js';
import type { PinnedEntry } from '../../packages/skill-manifest/src/schema.js';
import { revisionOf } from '../../packages/skill-sources/src/validation.js';

export const EXAMPLE_REMOTE = 'https://github.com/example-org/example-store';
export const EXAMPLE_COMMIT = '1f3a5c7e9b2d4f6a8c0e1f3a5c7e9b2d4f6a8c0e';
export const EXAMPLE_TREES = Object.freeze({ 'house-style': '2b4d6f8a0c1e3b5d7f9a2b4d6f8a0c1e3b5d7f9a', 'weekly-update': '3c5e7a9b1d2f4c6e8a0b3c5e7a9b1d2f4c6e8a0b', research: '4d6f8b0c2e3a5d7f9b1c4d6f8b0c2e3a5d7f9b1c' });

/** The files of each written store item: the path inside the item and its text. */
export const WRITTEN_FILES: Readonly<Record<'house-style' | 'weekly-update' | 'research', ReadonlyArray<readonly [string, string]>>> = Object.freeze({
  'house-style': [['SKILL.md', '---\nname: house-style\ndescription: Write in the house style of the team.\n---\n# House style\n\nShort sentences. Active voice.\n']],
  'weekly-update': [['weekly-update.md', '# Weekly update\n\nList what shipped, what is next, and what is blocked.\n']],
  research: [['agents/researcher.md', '# Researcher\n\nFind sources and cite each one.\n'], ['team.yaml', 'name: research\n']],
});

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');
/** The file rows of a lock item, sorted by path, and their hash, as the lock writer computes them. */
export function writtenRows(id: keyof typeof WRITTEN_FILES): { files: { path: string; sha256: string; bytes: number }[]; hash: string } {
  const files = [...WRITTEN_FILES[id]].sort(([a], [b]) => Buffer.compare(Buffer.from(a), Buffer.from(b))).map(([path, text]) => ({ path, sha256: sha256(text), bytes: Buffer.byteLength(text) }));
  return { files, hash: revisionOf(files) };
}

interface Expected { npmCollections(): Record<string, unknown> }
const expectedUrl = new URL('../../../packages/skill-manifest/test/support/expected.mjs', import.meta.url).href;
const { npmCollections } = await import(expectedUrl) as Expected;

/** The pinned store skill: a complete entry that validateEntry accepts, with teams ["research"]. */
export function tanstackPin(): PinnedEntry {
  return validateEntry({ id: 'tanstack-db', teams: ['research'], ...npmCollections() }) as PinnedEntry;
}

/** The example bowerloom.json: three skills, one prompt, and two teams. */
export function configValue(): ProjectConfig {
  return {
    // The docs show this file in the old form, so the example keeps it: `oldForm` makes serializeConfig write `harnesses`.
    format: CONFIG_FORMAT, engines: ['claude-code', 'codex'], oldForm: true,
    skills: [{ id: 'house-style', source: 'store' }, { id: 'local-tool', source: 'project' }, { id: 'tanstack-db', source: 'store', via: ['research'] }],
    prompts: [{ id: 'weekly-update', source: 'store' }],
    teams: [{ id: 'first-team', source: 'project' }, { id: 'research', source: 'store' }],
  };
}

const written = (kind: 'skill' | 'prompt' | 'team', id: keyof typeof WRITTEN_FILES): LockItem => {
  const { files, hash } = writtenRows(id);
  const path = kind === 'prompt' ? `prompts/${id}.md` : `${kind}s/${id}`;
  return { id, from: 'store', authored: { remote: EXAMPLE_REMOTE, commit: EXAMPLE_COMMIT, path, tree: EXAMPLE_TREES[id], files, hash } };
};

/** The example bowerloom.lock.json: exactly the four store entries of the config. */
export function lockValue(): ProjectLock {
  return {
    format: LOCK_FORMAT,
    skills: [written('skill', 'house-style'), { id: 'tanstack-db', from: 'store', pin: tanstackPin() }],
    prompts: [written('prompt', 'weekly-update')],
    teams: [written('team', 'research')],
  };
}

export const configExample = (): string => serializeConfig(configValue());
export const lockExample = (): string => serializeLock(lockValue());
