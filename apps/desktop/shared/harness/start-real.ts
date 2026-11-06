/**
 * The states of the real Start sheet, as one pure model (renderer/harness/sheets/StartRealSheet.tsx draws it). On the person's own folders Start shows a command and runs nothing,
 * so there is no "run" state. A folder can start when it holds a harness that loads. It offers the engines its harness lists that Start has a command for (Claude Code and Codex).
 * An engine that the install record does not list, or an install that stopped part way, sends the person to the install review first, as the sample's Start does.
 */
import { ENGINE_NAMES } from '../engine/types.js';
import type { EngineId, FolderInfo } from '../engine/types.js';
import { checkInstruction, isStartEngine } from '../engine/start-command.js';
import type { StartRefusalCode } from '../engine/start-command.js';

/** The part of a folder the model reads. */
export type StartFolder = Pick<FolderInfo, 'id' | 'hasDefinition' | 'engines' | 'installedEngines' | 'problem' | 'unfinished'>;

/** How an engine stands in a folder: its files are installed and no install stopped (`ready`), they are not (`not-installed`), or an install stopped part way (`stopped`). */
export type EngineState = 'ready' | 'not-installed' | 'stopped';

const startable = (f: StartFolder | undefined): f is StartFolder => f !== undefined && f.hasDefinition && f.problem === null;

/** The engines a folder offers: those its harness lists that Start has a command for, in the harness order. */
export function offeredEngines(f: StartFolder | undefined): EngineId[] {
  return startable(f) ? f.engines.filter(e => isStartEngine(e)) : [];
}

export function engineStateOf(f: StartFolder, engine: EngineId): EngineState {
  if (f.unfinished.projection) return 'stopped';
  return f.installedEngines.includes(engine) ? 'ready' : 'not-installed';
}

/** The folder the sheet opens on: the one asked for if it can start, else the first that can, else none (an empty id). */
export function firstStartFolder(folders: readonly StartFolder[], asked: string | null): string {
  const can = (f: StartFolder): boolean => offeredEngines(f).length > 0;
  const wanted = asked === null ? undefined : folders.find(f => f.id === asked);
  return (wanted !== undefined && can(wanted) ? wanted : folders.find(can))?.id ?? '';
}

/** The engines ticked at the start: the ones already installed in the folder, or else the first one offered. */
export function firstStartEngines(f: StartFolder | undefined): EngineId[] {
  const offered = offeredEngines(f);
  if (f === undefined) return [];
  const have = offered.filter(e => engineStateOf(f, e) === 'ready');
  return have.length > 0 ? have : offered.slice(0, 1);
}

/** The line under a folder in the list: what it offers, or why it cannot start (`off`). */
export function startFolderLine(f: FolderInfo): { words: string; off: boolean } {
  if (!f.hasDefinition) return { words: 'No harness here yet', off: true };
  if (f.problem !== null) return { words: f.problem, off: true };
  const offered = offeredEngines(f).map(e => ENGINE_NAMES[e]);
  if (offered.length === 0) return { words: 'No engine to start', off: true };
  return { words: offered.join(' and '), off: false };
}

export type StartStatus =
  | { readonly kind: 'no-project' } | { readonly kind: 'no-harness' } | { readonly kind: 'no-engine' } | { readonly kind: 'no-instruction' } | { readonly kind: 'too-long' }
  | { readonly kind: 'bad-text'; readonly code: StartRefusalCode }
  | { readonly kind: 'needs-install'; readonly engines: readonly EngineId[] }
  | { readonly kind: 'ready'; readonly engines: readonly EngineId[] };

/**
 * What the button does for these choices. The checks run in this order: the folder, the harness, the engines, then the instruction, then the install state, so the install review
 * never opens before the person has written what to start. A tick for an engine the folder does not offer counts for nothing. The engines come back in the harness order.
 */
export function startStatus(f: StartFolder | undefined, ticked: readonly EngineId[], instruction: string): StartStatus {
  if (f === undefined) return { kind: 'no-project' };
  if (!startable(f)) return { kind: 'no-harness' };
  const engines = offeredEngines(f).filter(e => ticked.includes(e));
  if (engines.length === 0) return { kind: 'no-engine' };
  const problem = checkInstruction(instruction);
  if (problem !== null) {
    if (problem.code === 'START_INSTRUCTION_EMPTY') return { kind: 'no-instruction' };
    if (problem.code === 'START_INSTRUCTION_TOO_LONG') return { kind: 'too-long' };
    return { kind: 'bad-text', code: problem.code };
  }
  const needs = engines.filter(e => engineStateOf(f, e) !== 'ready');
  return needs.length > 0 ? { kind: 'needs-install', engines: needs } : { kind: 'ready', engines };
}
