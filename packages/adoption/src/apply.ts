/**
 * Apply writes the plan a person approved, by copy, into the `.bowerloom` folder. It plans again under the project
 * lock and writes only when the revision is the same. Every write goes through the portable projection's write layer:
 * each folder above the path is checked just before the write, and each file is linked into place, so a file that
 * appeared since the plan is never overwritten. Apply creates files only; it never changes or deletes a file it did not
 * write. When anything fails, it removes what it wrote. After the writes, the definition must load and have the planned
 * revision, or apply removes what it wrote and refuses.
 */
import fs from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { loadDefinition } from '../../harness-definition/src/index.js';
import { withProjectLock } from '../../project-context/src/index.js';
import { PortableRefusal, checkAncestors, makeDir, readAbs, removeEmptyDirs, sha, writeAbs } from '../../project-sync/src/portable-files.js';
import type { AdoptionPlan } from './model.js';
import { planWithBytes, type AdoptionInput } from './plan.js';
import { AdoptionRefusal, refuse } from './refusal.js';

export interface AdoptionResult {
  readonly planRevision: string;
  /** The files written, relative to the `.bowerloom` folder, in byte order. */
  readonly written: readonly string[];
  /** The revision of the written definition. */
  readonly revision: string;
  readonly plan: AdoptionPlan;
}

/** Hooks for tests: `beforeWrite` runs before each file is written. Not exported from the package index. */
export interface ApplyHooks { readonly beforeWrite?: (rel: string) => void }

export async function applyAdoption(input: AdoptionInput, revision: string, signal: AbortSignal = new AbortController().signal): Promise<AdoptionResult> {
  return applyAdoptionWith(input, revision, signal, {});
}

export async function applyAdoptionWith(input: AdoptionInput, revision: string, signal: AbortSignal, hooks: ApplyHooks): Promise<AdoptionResult> {
  if (typeof revision !== 'string' || !/^[a-f0-9]{64}$/.test(revision)) refuse('ADOPTION_STALE_APPROVAL');
  const projectDir = input?.projectDir;
  if (typeof projectDir !== 'string' || !isAbsolute(projectDir)) refuse('ADOPTION_USAGE');
  return withProjectLock(projectDir, signal, async () => {
    const { plan, bytes, definitionRevision } = planWithBytes(input);
    if (plan.revision !== revision) refuse('ADOPTION_STALE_APPROVAL');
    if (plan.conflicts.some(c => c.choice === null)) refuse('ADOPTION_CHOICE_REQUIRED', plan.conflicts.filter(c => c.choice === null).map(c => c.key));
    if (plan.problems.length || definitionRevision === null) refuse('ADOPTION_DEFINITION_INVALID', [...new Set(plan.problems.map(p => `${p.path} (${p.code})`))], plan.problems);

    const written: { rel: string; sha256: string }[] = [];
    const created: string[] = [];
    const undo = (): string[] => {
      const left: string[] = [];
      for (const w of [...written].reverse()) {
        try {
          const now = readAbs(join(projectDir, w.rel), w.rel);
          if (now !== null && now.state.sha256 === w.sha256 && checkAncestors(projectDir, w.rel).length === 0) fs.unlinkSync(join(projectDir, w.rel));
          else if (now !== null) left.push(w.rel);
        } catch { left.push(w.rel); }
      }
      // A folder that is not empty, or no longer a plain folder, holds or is something adoption did not write: it stays,
      // and it is not a leftover of adoption. Any file adoption wrote and could not remove is listed above.
      for (const d of removeEmptyDirs(projectDir, created)) if (d.reason === 'error') left.push(d.path);
      return left;
    };
    const fail = (error: unknown): never => {
      const left = undo();
      if (left.length) refuse('ADOPTION_PARTIAL', left);
      if (error instanceof AdoptionRefusal) throw error;
      if (error instanceof PortableRefusal) refuse(error.code === 'PORTABLE_DRIFT' ? 'ADOPTION_STALE_APPROVAL' : 'ADOPTION_PATH_UNSAFE', error.paths);
      throw error;
    };

    try {
      for (const file of plan.files) {
        if (signal.aborted) refuse('ADOPTION_STALE_APPROVAL');
        const rel = `.bowerloom/${file.path}`;
        const f = bytes.get(file.path)!;
        if (sha(f.bytes) !== file.sha256) refuse('ADOPTION_STALE_APPROVAL');
        for (const dir of checkAncestors(projectDir, rel)) { makeDir(projectDir, dir); created.push(dir); }
        hooks.beforeWrite?.(rel);
        writeAbs(join(projectDir, rel), f.bytes, f.mode, {
          exclusive: true, label: rel,
          recheck: () => { if (checkAncestors(projectDir, rel, true).length) refuse('ADOPTION_PATH_UNSAFE', [rel]); },
          onPlaced: () => { written.push({ rel, sha256: file.sha256 }); },
        });
      }
      const loaded = loadDefinition(join(projectDir, '.bowerloom'));
      if (!loaded.ok) refuse('ADOPTION_DEFINITION_INVALID', [...new Set(loaded.problems.map(p => `${p.path} (${p.code})`))], loaded.problems);
      if (loaded.definition.revision !== definitionRevision) refuse('ADOPTION_STALE_APPROVAL');
      return { planRevision: plan.revision, written: plan.files.map(f => f.path), revision: loaded.definition.revision, plan };
    } catch (error) { return fail(error); }
  });
}
