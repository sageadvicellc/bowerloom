/**
 * The words and the plain-JSON round trip of export and import (spec 6.7 and 8), around `bundle.ts`.
 * The exported file is plain text. "Opening" it parses that text again, which proves the bundle travels, then asks `previewImport`
 * what would happen. "Installing" returns a new world for the second Bowerloom. The first world is never passed in here for writing.
 * Pure: no clock, no random number, no file.
 */
import { BUNDLE_LIMITS, commitImport, parseBundle, previewImport } from './bundle.js';
import { describeRule } from './slicerule.js';
import { ACCESS_WORDS } from './harnessmodel.js';
import type { Bundle, ImportClash, ImportGrant, ImportPreview, SecretSlot, ToolKind, World } from './types.js';

/** What the file holds and does not hold. Skill text, agent text and file locations are in it as written, so the promise says so. */
export const EXPORT_PROMISE = 'This file has no secret values that Bowerloom holds and no wiki page text. It does have the text of your skills and agents, and file locations inside each harness. Read it before you share it.';

/** The bundle as the text of the file. */
export function bundleText(bundle: Bundle): string {
  return JSON.stringify(bundle);
}

const KIND_WORDS: Readonly<Record<ToolKind, string>> = { mcp: 'MCP server', prompt: 'saved prompt', hook: 'hook (runs code)' };

/** "LANTERN_TOKEN, an environment variable" or "TIDAL_KEY, a keychain entry". The value is never named. */
export function secretWords(slot: SecretSlot): string {
  return `${slot.name}, ${slot.kind === 'env' ? 'an environment variable' : 'a keychain entry'}`;
}

export function clashWords(clash: ImportClash): string {
  return clash.reason === 'same-name'
    ? `${clash.name}: already there with the same text, so it is not added again.`
    : `${clash.name}: already there with different text, so it is kept under a new name.`;
}

/** "Planner may use Search: read and write." One access class an import would give. */
export const grantWords = (g: ImportGrant): string => `${g.agent} may use ${g.tool}: ${ACCESS_WORDS[g.access]}.`;

export interface ExportTool { readonly id: string; readonly name: string; readonly kindWords: string; readonly secretWords: string | null }
export interface ExportSlice { readonly name: string; readonly words: string }

export interface ExportSummary {
  readonly skills: number;
  readonly agents: number;
  readonly tools: readonly ExportTool[];
  readonly slices: readonly ExportSlice[];
  readonly promise: string;
  /** The size of the saved text in bytes. */
  readonly bytes: number;
}

/** What the file holds, in counts and words. A slice rule is told in plain words; only page counts, never page text, are used for that. */
export function describeExport(bundle: Bundle, world: World): ExportSummary {
  return {
    skills: bundle.items.filter(i => i.kind === 'skill').length,
    agents: bundle.items.filter(i => i.kind === 'agent').length,
    tools: bundle.toolRefs.map((t): ExportTool => ({ id: t.toolId, name: t.name, kindWords: KIND_WORDS[t.toolKind], secretWords: t.secret === null ? null : secretWords(t.secret) })),
    slices: bundle.sliceRules.map((s): ExportSlice => ({ name: s.name, words: describeRule(s.rule, world.wikiPages) })),
    promise: EXPORT_PROMISE,
    bytes: new TextEncoder().encode(bundleText(bundle)).length,
  };
}

/** What a person is told when the file cannot be opened. The reason is the plain sentence from `parseBundle`, or one of our own. */
function messageOf(error: unknown): string {
  if (error instanceof SyntaxError) return 'This file is damaged, or it is not a Bowerloom file. Bowerloom could not read it. Nothing was installed.';
  if (error instanceof Error && error.message !== '') return `${error.message} Nothing was installed.`;
  return 'This file could not be opened. Nothing was installed.';
}

export type OpenResult =
  | { readonly ok: true; readonly bundle: Bundle; readonly preview: ImportPreview }
  | { readonly ok: false; readonly message: string };

/** Reads the text of an exported file and previews the import into `target`. `target` is not changed. */
export function openExportedFile(text: string, target: World): OpenResult {
  if (new TextEncoder().encode(text).length > BUNDLE_LIMITS.textBytes) return { ok: false, message: 'This file is larger than 2 MB, which is more than a Bowerloom file ever holds. Nothing was installed.' };
  try {
    const bundle = parseBundle(JSON.parse(text) as unknown);
    return { ok: true, bundle, preview: previewImport(bundle, target) };
  } catch (error) { return { ok: false, message: messageOf(error) }; }
}

export type InstallResult =
  | { readonly ok: true; readonly world: World; readonly preview: ImportPreview }
  | { readonly ok: false; readonly message: string };

/** Reads the text of an exported file and returns `target` with the bundle added. `target` itself is not changed. */
export function installBundle(text: string, target: World): InstallResult {
  const opened = openExportedFile(text, target);
  if (!opened.ok) return opened;
  try { return { ok: true, world: commitImport(opened.bundle, target), preview: opened.preview }; } catch (error) { return { ok: false, message: messageOf(error) }; }
}
