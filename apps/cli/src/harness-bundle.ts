/**
 * `bowerloom harness export` and `bowerloom harness import`: the command line half of the harness bundle (0.8.0-beta.1, journey 4). The package
 * `packages/harness-bundle` owns the file, its checks and its summary. This module plans, asks for the approval, and writes.
 *
 * - Both commands print a plan first and write only after the same command runs again with `--approve <revision>` (confirm.ts). The plan lists every tool, every file that
 *   can run, every `${NAME}` value the file reads from this computer and where it goes, and every path from another computer.
 * - Export writes one new file with `--output`. It never replaces a file unless `--replace` is given, and then only the file it saw when it planned: the identity of
 *   that file (`bundleTargetIdentity`) is part of the revision, so an approval names it, and the writer reads it again right before the rename. Its revision is the
 *   SHA-256 of the file's bytes; with `--replace` over an existing file it is the SHA-256 of those bytes and that identity together.
 * - Import writes only into a folder whose harness is empty or missing. A missing harness is made empty inside the same plan and the same approval: the plan lists the
 *   files the import creates, and the approved revision covers them. The write itself is a save of the harness (`applySave`, under the project lock, with its journal).
 *   The command line keeps no save points: they belong to the app.
 * - A notes name is left out by default. `--link <name>=<folder>` links one. A name is a key from the file, so it is never used as an object property here.
 * - Nothing here runs an engine, a model, a hook, a script or a tool of the bundle. The bundle is data. The only program-like value is printed as plain text.
 * - No secret value appears: the file holds none, and a summary lists names only.
 */
import { lstatSync, readdirSync, realpathSync, unlinkSync } from 'node:fs';
import { userInfo } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { DefinitionError } from '../../../packages/contracts/src/index.js';
import { SaveRefusal, applySave, planSave } from '../../../packages/adoption/src/index.js';
import type { SavePlan } from '../../../packages/adoption/src/index.js';
import {
  HARNESS_FORMAT, INCOMPLETE_RULES, LEGACY_NAMES, loadDefinition, loadDefinitionFiles, scanSecrets, storedKnowledgePath,
} from '../../../packages/harness-definition/src/index.js';
import type { DefinitionFile } from '../../../packages/harness-definition/src/index.js';
import {
  BUNDLE_LIMITS, BundleRefusal, EXPORT_PLAN_FORMAT, IMPORT_PLAN_FORMAT, bundleTargetIdentity, decodeBundle, encodeBundle, exportAcknowledgement, importAcknowledgement,
  importChoicesOf, inspectBundle, isEmptyHarness, readBundleFile, targetFromBundle, writeBundleFile,
} from '../../../packages/harness-bundle/src/index.js';
import type { BundleFileIdentity, BundleSummary, ExportPlan, ImportPlan } from '../../../packages/harness-bundle/src/index.js';
import { EMPTY_HARNESS_DESCRIPTION } from '../../../packages/harness-bundle/src/target.js';
import { withProjectLock } from '../../../packages/project-context/src/index.js';
import type { PlannedChange } from '../../../packages/project-context/src/types.js';
import { checkPaths, stateExists } from '../../../packages/project-sync/src/portable-state.js';
import { PortableRefusal, byBytes, checkAncestors, makeDir, readProject, removeEmptyDirs, revisionOf, sha, writeAbs } from '../../../packages/project-sync/src/portable-files.js';
import { plainText } from './human.js';

const DEF = '.bowerloom';
const HEX64 = /^[a-f0-9]{64}$/;
const usage = (message: string): never => { throw new DefinitionError('USAGE', message); };
const stale = (): DefinitionError => new DefinitionError('STALE_APPROVAL', 'The plan changed after it was approved. Nothing was applied. Run the command again to see the new plan.');

// ---- words -------------------------------------------------------------------------------------------------------------

const count = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
/** Text from the bundle as one printed line, cut at `max` characters. Control characters are written out later, when the whole review is printed. */
function shown(text: string, max = 200): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const chars = [...flat];
  return chars.length <= max ? flat : `${chars.slice(0, max).join('')}... (${chars.length - max} more characters; --json shows what the file holds)`;
}
/** At most `BUNDLE_LIMITS.listRows` rows of a list, then one line for the rest. */
function rows(list: readonly string[]): string[] {
  const max = BUNDLE_LIMITS.listRows;
  return list.length <= max ? [...list] : [...list.slice(0, max), `  and ${list.length - max} more`];
}

/** The lines both reviews share: what the file holds, what can run, what it reads from this computer, and the paths of another computer. */
function summaryLines(s: BundleSummary, notesLine: (name: string, readBy: readonly string[]) => string): string[] {
  const c = s.counts, out: string[] = [];
  out.push(`  ${count(c.files, 'file')}, ${count(c.bytes, 'byte')}: ${count(c.skills, 'skill')}, ${count(c.agents, 'agent')}, ${count(c.mcp, 'MCP server')}, ${count(c.hooks, 'hook')}, ${count(c.guardrails, 'rule')}, ${count(c.scripts, 'script')}.`);
  if (s.tools.length) {
    out.push('Tools. Each one runs a program or reaches a host:');
    out.push(...rows(s.tools.map(t => {
      if (t.kind === 'hook') return `  hook ${t.name}${t.event !== undefined ? ` on ${t.event}` : ''}: runs ${shown(t.command ?? '')}`;
      const flags = t.addressFlags?.length ? ` (${t.addressFlags.join(', ')})` : '';
      return t.command !== undefined
        ? `  MCP server ${t.name} (${t.transport ?? 'stdio'}): runs ${shown([t.command, ...(t.args ?? [])].join(' '))}`
        : `  MCP server ${t.name} (${t.transport ?? 'http'}): reaches ${shown(t.host ?? 'no host')}${flags}`;
    })));
  }
  if (s.codeFiles.length) {
    out.push('Files that can run:');
    out.push(...rows(s.codeFiles.map(f => `  ${f.path}  (${f.why}, sha256 ${f.sha256.slice(0, 12)})`)));
  }
  if (s.secrets.length) {
    out.push('Values the file reads from this computer and passes to its tools. Bowerloom does not check that they exist:');
    out.push(...rows(s.secrets.map(x => {
      const name = x.kind === 'env' ? `\${${x.name}}` : `keychain entry ${x.name}`;
      return `  ${name} goes to ${x.sinks.map(k => `${k.tool} (${k.field}${k.host !== undefined ? ` at ${shown(k.host, 100)}` : ''})`).join(', ')}`;
    })));
  }
  if (s.notes.length) {
    out.push('Notes names. The folders stay on the computer that made the file:');
    out.push(...rows(s.notes.map(n => notesLine(n.name, n.readBy))));
  }
  if (s.borrowed.length) {
    out.push('Borrowed items:');
    out.push(...rows(s.borrowed.map(b => `  ${b.name} from ${b.marketplace}, version ${b.version}`)));
  }
  if (s.foreignPaths.length) {
    out.push('Text that holds a path of another computer. Bowerloom does not rewrite it:');
    out.push(...rows(s.foreignPaths.map(f => `  ${f.path}${f.line !== undefined ? ` line ${f.line}` : ''}: ${shown(f.text, 120)}`)));
  }
  return out;
}

// ---- the target file of an export --------------------------------------------------------------------------------------

/** The absolute target of `--output`: its folder as a real path, so the writer sees the folder it is given. The folder must exist. */
function outputTarget(cwd: string, given: string | undefined): string {
  if (given === undefined) return usage('harness export takes --output <file>.');
  if (given.includes('\0')) return usage('--output takes a file name.');
  const abs = resolve(cwd, given);
  let parent: string;
  try {
    parent = realpathSync(dirname(abs));
    if (!lstatSync(parent).isDirectory()) throw new Error('not a folder');
  } catch { return usage('The folder of --output does not exist.'); }
  return join(parent, basename(abs));
}
const sameIdentity = (a: BundleFileIdentity | null, b: BundleFileIdentity | null): boolean =>
  a === null || b === null ? a === b : a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeNs === b.mtimeNs && a.birthtimeNs === b.birthtimeNs;
const userName = (): string | undefined => { try { return userInfo().username; } catch { return undefined; } };
const acknowledgement = (given: string | undefined): string | undefined => {
  if (given !== undefined && !HEX64.test(given)) usage('--acknowledge takes the 64-character hash from the plan.');
  return given;
};

// ---- export ------------------------------------------------------------------------------------------------------------

export interface ExportRequest {
  /** The real path of the folder whose harness is exported. */
  readonly dir: string;
  readonly home: string;
  readonly cwd: string;
  /** `--output`, as the person gave it. */
  readonly output: string | undefined;
  readonly replace: boolean;
  readonly acknowledge: string | undefined;
}

/** The plan of an export. The extra fields are for a reader of `--json`: the hash of the bundle bytes, and the file that `--replace` would replace. */
export interface CliExportPlan extends ExportPlan {
  readonly bundleSha256: string;
  readonly replaces: { readonly bytes: number; readonly modified: string } | null;
}

export function exportReview(p: CliExportPlan): string {
  const out = [`Export the harness ${p.harness} to ${p.file}: ${count(p.bytes, 'byte')} in the file. Nothing is written until you approve.`];
  out.push(...summaryLines(p.summary, (name, readBy) => `  ${name}${readBy.length ? `, read by ${readBy.join(', ')}` : ''}`));
  if (p.replaces !== null) out.push(`The file exists (${count(p.replaces.bytes, 'byte')}, changed ${p.replaces.modified}). It is replaced only if it is still that same file when you approve.`);
  if (p.acknowledge !== null) out.push(`Read the paths above. To go on, run the command again with --acknowledge ${p.acknowledge} and --approve.`);
  return out.join('\n');
}

export function exportChange(r: ExportRequest): PlannedChange<CliExportPlan> {
  const target = outputTarget(r.cwd, r.output), ack = acknowledgement(r.acknowledge);
  let bytes: Uint8Array = new Uint8Array(), identity: BundleFileIdentity | null = null, seen: { identity: BundleFileIdentity | null } | null = null;
  async function plan(): Promise<CliExportPlan> {
    const loaded = loadDefinition(join(r.dir, DEF));
    if (!loaded.ok) {
      if (loaded.problems.some(p => p.code === 'FOLDER_MISSING')) return usage('This folder has no harness to export. Run bowerloom harness adopt first.');
      // A secret value in a file is its own refusal, as it is on import. The problem names the file and the rule, never the value.
      const secrets = loaded.problems.filter(p => p.code === 'SECRET_VALUE');
      if (secrets.length) throw new BundleRefusal('BUNDLE_SECRET_FOUND', [...new Set(secrets.map(p => p.path))], loaded.problems);
      throw new BundleRefusal('BUNDLE_INVALID', [...new Set(loaded.problems.map(p => p.path))], loaded.problems);
    }
    const user = userName();
    const encoded = await encodeBundle(loaded.definition, { home: r.home, ...(user !== undefined ? { user } : {}) });
    identity = await bundleTargetIdentity(target);
    if (identity !== null && !r.replace) throw new BundleRefusal('BUNDLE_EXISTS');
    // A second plan (the prompt, then the apply) must find the same file at the target as the first one saw.
    if (seen !== null && !sameIdentity(seen.identity, identity)) throw stale();
    seen ??= { identity };
    bytes = encoded.bytes;
    // Each CLI run is its own process, so an approval can name the file it replaces only through the revision.
    const revision = identity === null ? encoded.sha256 : sha(JSON.stringify(['bowerloom/export-replace/v1', encoded.sha256, [identity.dev, identity.ino, identity.size, identity.mtimeNs, identity.birthtimeNs].map(String)]));
    return {
      format: EXPORT_PLAN_FORMAT, harness: loaded.definition.harness.id, file: r.output!, bytes: encoded.bytes.length, summary: encoded.summary,
      revision, acknowledge: exportAcknowledgement(encoded.summary, revision), bundleSha256: encoded.sha256,
      replaces: identity === null ? null : { bytes: Number(identity.size), modified: new Date(Number(identity.mtimeNs / 1_000_000n)).toISOString() },
    };
  }
  return {
    plan, revision: p => p.revision, review: exportReview,
    async apply(revision) {
      const p = await plan();
      if (p.revision !== revision) throw stale();
      if (p.acknowledge !== null && ack !== p.acknowledge) throw new BundleRefusal('EXPORT_NEEDS_ACKNOWLEDGEMENT');
      if (p.acknowledge === null && ack !== undefined) usage('This plan has nothing to acknowledge. Run the command again without --acknowledge.');
      await writeBundleFile(target, bytes, identity === null ? {} : { replace: identity });
      return { written: p.file, bytes: p.bytes, replaced: identity !== null };
    },
  };
}

// ---- import: the choices -----------------------------------------------------------------------------------------------

export interface ImportRequest {
  /** The real path of the folder the harness goes into. */
  readonly dir: string;
  /** The private state folder of adoption, where the save journal goes. */
  readonly stateDir: string;
  readonly home: string;
  readonly cwd: string;
  /** The bundle file, as the person gave it. */
  readonly file: string;
  /** `--link <name>=<folder>`, as given. */
  readonly link: readonly string[];
  /** `--leave <name>`, as given. */
  readonly leave: readonly string[];
  readonly acknowledge: string | undefined;
  readonly signal: AbortSignal;
  /** Seams for tests. Production code sets none. `afterEmpty` runs once the empty harness is on disk, before the save is planned. */
  readonly hooks?: { readonly afterEmpty?: () => void };
}

/** The plan of an import. The extra fields are for a reader of `--json`: the hash of the bundle file, and whether the plan makes the empty harness first. */
export interface CliImportPlan extends ImportPlan {
  readonly bundleSha256: string;
  readonly makesEmptyHarness: boolean;
}

interface Choices { readonly link: Map<string, string>; readonly leave: Set<string> }
/** `--link name=folder` and `--leave name`, as the stored form of a folder. A name is a key from the file: it goes into a Map and a Set, never into an object. */
function parseChoices(r: ImportRequest): Choices {
  const link = new Map<string, string>(), leave = new Set<string>();
  for (const word of r.link) {
    const eq = word.indexOf('=');
    if (eq <= 0 || eq === word.length - 1) usage('--link takes <name>=<folder>.');
    const name = word.slice(0, eq);
    if (link.has(name)) usage(`Link each notes name once.`);
    const stored = storedKnowledgePath(word.slice(eq + 1), { root: r.dir, home: r.home });
    if (!stored.ok) usage(`--link: ${stored.message}`);
    else link.set(name, stored.path);
  }
  for (const name of r.leave) {
    if (leave.has(name)) usage('Name each notes name once with --leave.');
    leave.add(name);
  }
  return { link, leave };
}

// ---- import: the state of the folder -----------------------------------------------------------------------------------

/** What `.bowerloom` may hold when it has no `harness.json`: nothing the loader reads. A 0.7 file is not read, and a save never touches one. */
const QUIET = new Set<string>([...LEGACY_NAMES, '.DS_Store', '.gitkeep']);
const enoent = (error: unknown): boolean => (error as NodeJS.ErrnoException | null)?.code === 'ENOENT';

/**
 * `empty`: the folder has a harness with no part. `missing`: it has none, and `dirExists` says whether `.bowerloom` is there. A harness with parts, and a
 * `.bowerloom` that holds anything the loader would read, are IMPORT_FOLDER_HAS_HARNESS. A link or a file where a folder belongs is SAVE_PATH_UNSAFE.
 */
function folderState(dir: string): { readonly kind: 'empty' } | { readonly kind: 'missing'; readonly dirExists: boolean } {
  const def = join(dir, DEF);
  try {
    const st = lstatSync(def);
    if (!st.isDirectory()) throw new SaveRefusal('SAVE_PATH_UNSAFE', [DEF]);
  } catch (error) {
    if (error instanceof SaveRefusal) throw error;
    if (enoent(error)) return { kind: 'missing', dirExists: false };
    throw new SaveRefusal('SAVE_PATH_UNSAFE', [DEF]);
  }
  let harness: boolean;
  try { const st = lstatSync(join(def, 'harness.json')); if (!st.isFile()) throw new SaveRefusal('SAVE_PATH_UNSAFE', ['harness.json']); harness = true; } catch (error) {
    if (error instanceof SaveRefusal) throw error;
    if (!enoent(error)) throw new SaveRefusal('SAVE_PATH_UNSAFE', ['harness.json']);
    harness = false;
  }
  if (!harness) {
    let names: string[];
    try { names = readdirSync(def); } catch { throw new SaveRefusal('SAVE_PATH_UNSAFE', [DEF]); }
    if (names.some(n => !QUIET.has(n))) throw new BundleRefusal('IMPORT_FOLDER_HAS_HARNESS');
    return { kind: 'missing', dirExists: true };
  }
  const loaded = loadDefinition(def);
  if (!loaded.ok) throw new SaveRefusal('SAVE_DEFINITION_INVALID', [...new Set(loaded.problems.map(p => `${p.path} (${p.code})`))], loaded.problems);
  if (!isEmptyHarness(loaded.definition)) throw new BundleRefusal('IMPORT_FOLDER_HAS_HARNESS');
  return { kind: 'empty' };
}

/** The harness that a missing one is made into first: the bundle's id and engines, and no part. The bundle's own `harness.json` replaces it in the same save. */
function emptyHarnessBytes(summary: BundleSummary): Uint8Array {
  const bytes = Buffer.from(`${JSON.stringify({
    format: HARNESS_FORMAT, id: summary.harness, description: EMPTY_HARNESS_DESCRIPTION, engines: summary.engines.map(id => ({ id })), parts: {},
  }, null, 2)}\n`, 'utf8');
  if (!loadDefinitionFiles([{ path: 'harness.json', bytes }], '').ok) throw new BundleRefusal('BUNDLE_INVALID');
  return bytes;
}

/** A portable write refusal as the save maps it: a file that appeared since the check is a stale plan, anything else is an unsafe path. */
function mapPortable(error: unknown): never {
  if (error instanceof PortableRefusal) {
    if (error.code === 'PORTABLE_DRIFT') throw stale();
    throw new SaveRefusal('SAVE_PATH_UNSAFE', error.paths.map(p => (p.startsWith(`${DEF}/`) ? p.slice(DEF.length + 1) : p)));
  }
  throw error;
}

/**
 * The checks of the save's own input, run before anything is written. For a harness that is missing, `planSave` cannot run until the empty one is on disk,
 * so a state folder it would refuse must be found now, not after the first write.
 */
function checkState(projectDir: string, stateDir: string): void {
  try { checkPaths(projectDir, stateDir); stateExists(stateDir); } catch (error) {
    if (error instanceof PortableRefusal) throw new SaveRefusal(error.code === 'PORTABLE_USAGE' ? 'SAVE_USAGE' : 'SAVE_STATE_UNSAFE');
    throw error;
  }
}

// ---- import: the plan --------------------------------------------------------------------------------------------------

/** What a plan holds besides the public plan: the files the save writes, and for a missing harness the bytes of the empty one. */
interface Held { readonly plan: CliImportPlan; readonly target: readonly DefinitionFile[]; readonly empty: Uint8Array | null; readonly dirExists: boolean; readonly targetRevision: string }

function filesOfTarget(target: readonly DefinitionFile[]): readonly { path: string; action: 'create'; sha256: string }[] {
  const all = target.map(f => ({ path: f.path, action: 'create' as const, sha256: sha(f.bytes) }));
  const body = all.filter(f => f.path !== 'harness.json').sort((a, b) => byBytes(a.path, b.path));
  return [...body, ...all.filter(f => f.path === 'harness.json')];
}

export function importReview(p: CliImportPlan): string {
  const out = [`Import the harness ${p.harness} from ${p.file} into ${p.folder}. Nothing is written until you approve.`];
  if (p.makesEmptyHarness) out.push('This folder has no harness yet. The import makes an empty one first, in the same step.');
  out.push(...summaryLines(p.summary, (name, readBy) => `  ${name}${readBy.length ? `, read by ${readBy.join(', ')}` : ''}: left out. Add --link ${name}=<folder> to link a folder.`));
  out.push(`The import writes ${count(p.changes.length, 'file')} in .bowerloom:`);
  out.push(...rows(p.changes.map(c => `  ${c.action.padEnd(6)} ${c.path}`)));
  out.push('The import installs nothing. Run bowerloom harness install afterward to see that plan.');
  if (p.acknowledge !== null) out.push(`Read the tools, files, values, and paths above. To go on, run the command again with --acknowledge ${p.acknowledge} and --approve.`);
  return out.join('\n');
}

export function importChange(r: ImportRequest): PlannedChange<CliImportPlan> {
  const choices = parseChoices(r), ack = acknowledgement(r.acknowledge);
  const file = resolve(r.cwd, r.file);
  if (r.file.includes('\0')) usage('The import takes the path of a bundle file.');
  let held: Held | null = null;
  const input = { projectDir: r.dir, stateDir: r.stateDir };

  async function plan(): Promise<CliImportPlan> {
    try { lstatSync(file); } catch (error) { if (enoent(error)) usage('The bundle file does not exist.'); }
    const bundle = await decodeBundle(await readBundleFile(file));
    const summary = inspectBundle(bundle);
    const picked = importChoicesOf({ link: choices.link, leave: choices.leave }, bundle.knowledge.map(k => k.name));
    const target = targetFromBundle(bundle, picked);
    const state = folderState(r.dir);
    const executables = target.filter(f => f.executable === true).map(f => f.path);
    let changes: ImportPlan['changes'], revision: string, empty: Uint8Array | null = null, targetRevision: string;
    if (state.kind === 'empty') {
      const save: SavePlan = planSave(input, target);
      changes = save.changes.map(c => ({ path: c.path, action: c.action }));
      revision = save.revision; targetRevision = save.targetRevision;
    } else {
      // No harness on disk, so the save cannot be planned yet. The files are checked in memory the way the save checks them, and the approved revision covers
      // the bytes of every file, the empty harness, and the definition that results.
      checkState(r.dir, r.stateDir);
      empty = emptyHarnessBytes(summary);
      const list = target.map(f => ({ path: f.path, bytes: f.bytes, executable: f.executable === true }));
      const incomplete = new Set<string>(INCOMPLETE_RULES);
      const findings = scanSecrets(list).filter(f => !incomplete.has(f.rule));
      if (findings.length) throw new SaveRefusal('SAVE_SECRET_FOUND', [...new Set(findings.map(f => f.path))]);
      const loaded = loadDefinitionFiles(list, join(r.dir, DEF));
      if (!loaded.ok) throw new SaveRefusal('SAVE_DEFINITION_INVALID', [...new Set(loaded.problems.map(p => `${p.path} (${p.code})`))], loaded.problems);
      targetRevision = loaded.definition.revision;
      const files = filesOfTarget(target);
      changes = files.map(f => ({ path: f.path, action: f.action }));
      revision = revisionOf({
        format: IMPORT_PLAN_FORMAT, projectDir: r.dir, bundle: bundle.sha256, empty: sha(empty), dirExists: state.dirExists, files: files.map(f => [f.path, f.sha256]),
        executables: executables.slice().sort(byBytes), targetRevision,
      });
    }
    const plan: CliImportPlan = {
      format: IMPORT_PLAN_FORMAT, harness: summary.harness, folder: r.dir, file: r.file, summary, changes, revision, acknowledge: importAcknowledgement(summary, executables, revision),
      bundleSha256: bundle.sha256, makesEmptyHarness: state.kind === 'missing',
    };
    held = { plan, target, empty, dirExists: state.kind === 'missing' && state.dirExists, targetRevision };
    return plan;
  }

  /** Puts the empty harness in place under the project lock, and returns what undoes it. */
  async function makeEmpty(h: Held): Promise<void> {
    const rel = `${DEF}/harness.json`;
    await withProjectLock(r.dir, r.signal, async () => {
      try {
        if (readProject(r.dir, rel) !== null) throw stale();
        for (const d of checkAncestors(r.dir, rel)) makeDir(r.dir, d);
        writeAbs(join(r.dir, rel), h.empty!, 0o644, { exclusive: true, label: rel, recheck: () => { checkAncestors(r.dir, rel, true); } });
      } catch (error) { mapPortable(error); }
    });
  }
  /** Takes the empty harness out again, only while it is still exactly the bytes this command wrote. Returns false when it could not. */
  async function takeEmptyOut(h: Held): Promise<boolean> {
    const rel = `${DEF}/harness.json`;
    try {
      await withProjectLock(r.dir, r.signal, async () => {
        const now = readProject(r.dir, rel);
        if (now === null) return;
        if (!now.bytes.equals(Buffer.from(h.empty!))) throw new Error('changed');
        unlinkSync(join(r.dir, rel));
        if (!h.dirExists) removeEmptyDirs(r.dir, [DEF]);
      });
      return true;
    } catch { return false; }
  }

  return {
    plan, revision: p => p.revision, review: importReview,
    async apply(revision) {
      const p = await plan();
      if (p.revision !== revision) throw stale();
      if (p.acknowledge !== null && ack !== p.acknowledge) throw new BundleRefusal('IMPORT_NEEDS_ACKNOWLEDGEMENT');
      if (p.acknowledge === null && ack !== undefined) usage('This plan has nothing to acknowledge. Run the command again without --acknowledge.');
      const h = held!;
      const notes = [
        'Nothing was installed. Run bowerloom harness install to see that plan.',
        ...(p.summary.secrets.length ? [`The file names these values, and Bowerloom did not check that they exist on this computer: ${p.summary.secrets.map(s => s.name).join(', ')}.`] : []),
      ];
      if (!p.makesEmptyHarness) {
        const done = await applySave(input, p.revision, h.target, r.signal);
        return { written: done.written.map(w => `${DEF}/${w}`), revision: done.revision, warnings: [...(done.journalLeft ? ['The save finished, but its journal could not be removed. Recover it in the Bowerloom app before another save.'] : []), ...notes] };
      }
      await makeEmpty(h);
      try {
        r.hooks?.afterEmpty?.();
        const second = planSave(input, h.target);
        // The folder must still be exactly what the plan showed: the empty harness, and nothing else. A file that appeared in between would be updated or deleted.
        const created = second.changes.filter(c => c.path !== 'harness.json');
        const expected = h.plan.changes.filter(c => c.path !== 'harness.json').map(c => c.path).sort(byBytes);
        const only = second.changes.every(c => c.action === 'create' || (c.path === 'harness.json' && c.action === 'update'));
        const harness = second.changes.find(c => c.path === 'harness.json');
        const ours = harness === undefined || harness.before?.sha256 === sha(h.empty!);
        if (second.targetRevision !== h.targetRevision || !only || !ours || created.map(c => c.path).sort(byBytes).join('\n') !== expected.join('\n')) throw stale();
        const done = await applySave(input, second.revision, h.target, r.signal);
        return { written: done.written.map(w => `${DEF}/${w}`), revision: done.revision, warnings: [...(done.journalLeft ? ['The save finished, but its journal could not be removed. Recover it in the Bowerloom app before another save.'] : []), ...notes] };
      } catch (error) {
        // A save that stopped part way keeps its journal, and its files are not the empty harness: leave all of it for the recovery.
        if ((error as { code?: unknown } | null)?.code === 'SAVE_PARTIAL' || (error as { crash?: unknown } | null)?.crash === true) throw error;
        if (!(await takeEmptyOut(h))) {
          const code = (error as { code?: unknown } | null)?.code;
          throw new DefinitionError(typeof code === 'string' ? code : 'IO_ERROR', `${plainText(String((error as { message?: unknown } | null)?.message ?? ''))} The empty harness.json this command made is still in .bowerloom. Remove it by hand, or import again.`);
        }
        throw error;
      }
    },
  };
}
