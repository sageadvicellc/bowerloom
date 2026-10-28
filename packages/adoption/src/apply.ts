/**
 * Apply writes the plan a person approved, by copy, into the `.bowerloom` folder. It plans again under the project
 * lock, with the same input (its `everyEngine` choice included, decision D8B), and writes only when the revision is the
 * same, every conflict has a choice, every gated unmapped entry is acknowledged, nothing blocks, and every item that
 * needs approval is in `approvals` (ruling A7).
 *
 * Every write goes through the portable projection's write layer: each folder above the path is checked just before the
 * write, and each file is linked into place, so a file that appeared since the plan is never overwritten. Apply creates
 * files only; it never changes or deletes a file it did not write.
 *
 * Ruling A11: before the first write, a journal in the state folder lists the planned files and folders, and
 * `harness.json` is written last, so a stopped run never leaves a definition. When anything fails, apply removes what it
 * wrote and the journal. When it cannot remove everything, it keeps the journal and refuses ADOPTION_PARTIAL with the
 * code that stopped it (A16), and the next plan asks for a recovery. A folder is tracked from the moment it is made (A20).
 */
import fs from 'node:fs';
import { join } from 'node:path';
import { loadDefinition } from '../../harness-definition/src/index.js';
import { withProjectLock } from '../../project-context/src/index.js';
import { PortableRefusal, byBytes, checkAncestors, makeDir, readAbs, removeEmptyDirs, sha, writeAbs } from '../../project-sync/src/portable-files.js';
import { removeJournal, writeJournal } from './journal.js';
import type { AdoptionPlan } from './model.js';
import { planWithBytes, type AdoptionInput } from './plan.js';
import { AdoptionRefusal, refuse } from './refusal.js';

export interface AdoptionResult {
  readonly planRevision: string;
  /** The files written, relative to the `.bowerloom` folder, in the order written: `harness.json` last. */
  readonly written: readonly string[];
  /** The revision of the written definition. */
  readonly revision: string;
  readonly plan: AdoptionPlan;
}

/**
 * Hooks for tests. Not exported from the package index. `beforeWrite` runs before each file is written, `afterMkdir`
 * right after a folder is made. An error with `crash: true` stands for a process that died: apply then removes nothing
 * and keeps the journal.
 */
export interface ApplyHooks { readonly beforeWrite?: (rel: string) => void; readonly afterMkdir?: (rel: string) => void }

export async function applyAdoption(input: AdoptionInput, revision: string, approvals: readonly string[], signal: AbortSignal = new AbortController().signal): Promise<AdoptionResult> {
  return applyAdoptionWith(input, revision, approvals, signal, {});
}

/** The adoption code of an error: a portable write refusal maps as apply maps it; any other error keeps its own code. */
const codeOf = (e: unknown): string => e instanceof PortableRefusal ? (e.code === 'PORTABLE_DRIFT' ? 'ADOPTION_STALE_APPROVAL' : 'ADOPTION_PATH_UNSAFE')
  : typeof (e as { code?: unknown } | null)?.code === 'string' ? (e as { code: string }).code : 'ERROR';

export async function applyAdoptionWith(input: AdoptionInput, revision: string, approvals: readonly string[], signal: AbortSignal, hooks: ApplyHooks): Promise<AdoptionResult> {
  if (typeof revision !== 'string' || !/^[a-f0-9]{64}$/.test(revision)) refuse('ADOPTION_STALE_APPROVAL');
  if (!Array.isArray(approvals) || approvals.some(a => typeof a !== 'string')) refuse('ADOPTION_USAGE');
  const projectDir = input?.projectDir;
  if (typeof projectDir !== 'string' || !projectDir.startsWith('/')) refuse('ADOPTION_USAGE');
  return withProjectLock(projectDir, signal, async () => {
    const { plan, bytes, definitionRevision } = planWithBytes(input);
    if (plan.revision !== revision) refuse('ADOPTION_STALE_APPROVAL');
    if (plan.conflicts.some(c => c.choice === null)) refuse('ADOPTION_CHOICE_REQUIRED', plan.conflicts.filter(c => c.choice === null).map(c => c.key));
    const waiting = plan.unmapped.filter(u => u.gate === 'acknowledge' && !u.acknowledged);
    if (waiting.length) refuse('ADOPTION_ACKNOWLEDGEMENT_REQUIRED', waiting.map(u => u.id));
    const blocked = plan.unmapped.filter(u => u.gate === 'block');
    if (blocked.length) refuse('ADOPTION_AT_IMPORT', blocked.map(u => u.id));
    if (plan.problems.length || definitionRevision === null) refuse('ADOPTION_DEFINITION_INVALID', [...new Set(plan.problems.map(p => `${p.path} (${p.code})`))], plan.problems);
    const required = new Set(plan.approvalsRequired);
    if (approvals.some(a => !required.has(a))) refuse('ADOPTION_USAGE');
    const missing = plan.approvalsRequired.filter(a => !approvals.includes(a));
    if (missing.length) refuse('ADOPTION_APPROVAL_REQUIRED', missing);

    const stateDir = input.stateDir;
    const order = [...plan.files.filter(f => f.path !== 'harness.json'), ...plan.files.filter(f => f.path === 'harness.json')];
    const rels = order.map(f => `.bowerloom/${f.path}`);
    const dirs = [...new Set(rels.flatMap(rel => checkAncestors(projectDir, rel)))].sort(byBytes);
    writeJournal(stateDir, { format: 'bowerloom/adoption-pending/v1beta1', projectDir, planRevision: plan.revision, files: order.map((f, i) => ({ path: rels[i]!, sha256: f.sha256 })), dirs });

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
      if ((error as { crash?: unknown } | null)?.crash === true) throw error;
      const left = undo();
      if (left.length) refuse('ADOPTION_PARTIAL', left, [], codeOf(error));
      removeJournal(stateDir);
      if (error instanceof AdoptionRefusal) throw error;
      if (error instanceof PortableRefusal) refuse(error.code === 'PORTABLE_DRIFT' ? 'ADOPTION_STALE_APPROVAL' : 'ADOPTION_PATH_UNSAFE', error.paths);
      throw error;
    };

    try {
      for (let i = 0; i < order.length; i++) {
        if (signal.aborted) refuse('ADOPTION_ABORTED');
        const file = order[i]!, rel = rels[i]!;
        const f = bytes.get(file.path)!;
        if (sha(f.bytes) !== file.sha256) refuse('ADOPTION_STALE_APPROVAL');
        for (const dir of checkAncestors(projectDir, rel)) makeDir(projectDir, dir, made => { created.push(made); hooks.afterMkdir?.(made); });
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
      removeJournal(stateDir);
      return { planRevision: plan.revision, written: order.map(f => f.path), revision: loaded.definition.revision, plan };
    } catch (error) { return fail(error); }
  });
}
