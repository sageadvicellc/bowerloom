/**
 * The authoring records in `.bowerloom/authoring/`: `receipt.json` (bowerloom/authoring-receipt/v1beta1) lists the
 * created items, and `pending.json` records the one item a create is writing. Bowerloom's own scratch names there are
 * `.stage-<64 hex>` and `.tmp-<64 hex>-receipt|pending`. Internal to packages/project-authoring.
 */
import { join } from 'node:path';
import { canonicalJson } from '../../contracts/src/index.js';
import { LIMITS, folderNames, lstatOrNull, readGuarded, realFolder, sha256 } from './files.js';
import type { FilePin } from './files.js';
import { ensure, refuse } from './refusal.js';
import type { AuthoringRefusalCode } from './refusal.js';

export const AUTHORING_RECEIPT_FORMAT = 'bowerloom/authoring-receipt/v1beta1' as const;
export const AUTHORING_PENDING_FORMAT = 'bowerloom/authoring-pending/v1beta1' as const;
export const AUTHORING_FOLDER = 'authoring' as const;
export const RECEIPT = 'receipt.json' as const;
export const PENDING = 'pending.json' as const;
export const SCRATCH = /^\.(?:stage-[a-f0-9]{64}|tmp-[a-f0-9]{64}-(?:receipt|pending))$/;
export const stageName = (planRevision: string): string => `.stage-${planRevision}`;
export const tempName = (planRevision: string, record: 'receipt' | 'pending'): string => `.tmp-${planRevision}-${record}`;

export type ItemKind = 'team' | 'skill' | 'prompt';
export const KINDS: readonly ItemKind[] = ['team', 'skill', 'prompt'];
export const FIRST_TEAM = 'first-team';
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HEX64 = /^[a-f0-9]{64}$/;
export const isId = (v: unknown): v is string => typeof v === 'string' && v.length <= 64 && ID.test(v);
export const isTeamId = (v: unknown): v is string => isId(v) && v !== FIRST_TEAM;
export const isSkillId = (v: unknown): v is string => isId(v) && v !== 'personal-assistant' && !v.startsWith('prompt-');
/** `prompt-<id>` is the Codex wrapper's folder name, so a prompt id leaves room for that prefix. */
export const isPromptId = (v: unknown): v is string => isId(v) && v.length <= 57;
export const isRevision = (v: unknown): v is string => typeof v === 'string' && HEX64.test(v);
const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;

/** Where an item lives, relative to `.bowerloom`: a folder for a team or a skill, one file for a prompt. */
export function itemPath(kind: ItemKind, id: string): string {
  return kind === 'team' ? `teams/${id}` : kind === 'skill' ? `skills/${id}` : `prompts/${id}.md`;
}

export interface AuthoredItem { kind: ItemKind; id: string; teams: string[]; files: FilePin[]; planRevision: string }
export interface AuthoringReceipt { format: typeof AUTHORING_RECEIPT_FORMAT; items: AuthoredItem[]; revision: string }
export interface PendingRecord { format: typeof AUTHORING_PENDING_FORMAT; item: AuthoredItem; revision: string }

function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
    && Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k));
}
const SEGMENT = /^[^\0/\\\p{Cc}\p{Cf}]{1,255}$/u;
/** A file path of an item: inside the item's own path, with plain segments only. */
function itemFile(kind: ItemKind, id: string, path: unknown): boolean {
  if (typeof path !== 'string' || Buffer.byteLength(path) > 1024) return false;
  if (kind === 'prompt') return path === itemPath(kind, id);
  const root = `${itemPath(kind, id)}/`, rest = path.startsWith(root) ? path.slice(root.length).split('/') : [];
  return rest.length >= 1 && rest.length <= LIMITS.depth && rest.every(s => SEGMENT.test(s) && s !== '.' && s !== '..');
}
/** Normalizes an item, refusing with `code` when it is not exactly an item. */
export function validItem(value: unknown, code: AuthoringRefusalCode): AuthoredItem {
  ensure(exact(value, ['kind', 'id', 'teams', 'files', 'planRevision']), code);
  const { kind, id, teams, files, planRevision } = value;
  ensure(KINDS.includes(kind as ItemKind), code);
  const k = kind as ItemKind;
  ensure(k === 'team' ? isTeamId(id) : k === 'skill' ? isSkillId(id) : isPromptId(id), code);
  ensure(Array.isArray(teams) && teams.length <= 32 && teams.every(isId) && (k !== 'team' || teams.length === 0), code);
  ensure(teams.every((t, i) => i === 0 || compare(teams[i - 1] as string, t as string) < 0), code);
  ensure(Array.isArray(files) && files.length >= 1 && files.length <= LIMITS.itemEntries, code);
  const pins = files.map(f => {
    ensure(exact(f, ['path', 'sha256', 'bytes']) && itemFile(k, id as string, f.path) && isRevision(f.sha256) && Number.isSafeInteger(f.bytes) && (f.bytes as number) >= 0 && (f.bytes as number) <= LIMITS.fileBytes, code);
    return { path: f.path as string, sha256: f.sha256 as string, bytes: f.bytes as number };
  });
  ensure(pins.every((p, i) => i === 0 || compare(pins[i - 1]!.path, p.path) < 0), code);
  ensure(isRevision(planRevision), code);
  return { kind: k, id: id as string, teams: [...teams as string[]], files: pins, planRevision };
}
const itemKey = (item: { kind: string; id: string }): string => `${item.kind}\0${item.id}`;
export const sameItem = (a: { kind: string; id: string }, b: { kind: string; id: string }): boolean => a.kind === b.kind && a.id === b.id;

export function receiptOf(items: readonly AuthoredItem[]): AuthoringReceipt {
  const sorted = [...items].sort((a, b) => compare(itemKey(a), itemKey(b)));
  const body = { format: AUTHORING_RECEIPT_FORMAT, items: sorted };
  return { ...body, revision: sha256(canonicalJson(body)) };
}
export function pendingOf(item: AuthoredItem): PendingRecord {
  const body = { format: AUTHORING_PENDING_FORMAT, item };
  return { ...body, revision: sha256(canonicalJson(body)) };
}
/** The exact bytes of a record. A record on disk must equal them, so a hand edit or a duplicate key is refused. */
export const recordText = (value: AuthoringReceipt | PendingRecord): string => `${JSON.stringify(value, null, 2)}\n`;

function parseRecord(bytes: Buffer, code: AuthoringRefusalCode): unknown {
  let value: unknown;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { return refuse(code); }
  return value;
}
export function parseReceipt(bytes: Buffer): AuthoringReceipt {
  const value = parseRecord(bytes, 'AUTHORING_RECEIPT_INVALID');
  ensure(exact(value, ['format', 'items', 'revision']) && value.format === AUTHORING_RECEIPT_FORMAT && Array.isArray(value.items) && value.items.length <= LIMITS.items, 'AUTHORING_RECEIPT_INVALID');
  const items = (value.items as unknown[]).map(i => validItem(i, 'AUTHORING_RECEIPT_INVALID'));
  ensure(items.every((it, i) => i === 0 || compare(itemKey(items[i - 1]!), itemKey(it)) < 0), 'AUTHORING_RECEIPT_INVALID');
  const receipt = receiptOf(items);
  ensure(receipt.revision === value.revision && Buffer.from(recordText(receipt)).equals(bytes), 'AUTHORING_RECEIPT_INVALID');
  return receipt;
}
export function parsePending(bytes: Buffer): PendingRecord {
  const value = parseRecord(bytes, 'AUTHORING_PENDING');
  ensure(exact(value, ['format', 'item', 'revision']) && value.format === AUTHORING_PENDING_FORMAT, 'AUTHORING_PENDING');
  const record = pendingOf(validItem(value.item, 'AUTHORING_PENDING'));
  ensure(record.revision === value.revision && Buffer.from(recordText(record)).equals(bytes), 'AUTHORING_PENDING');
  return record;
}

export interface Read { sha256: string; bytes: number }
export interface AuthoringState {
  /** False when `.bowerloom/authoring` is absent. */
  folder: boolean;
  receipt: { value: AuthoringReceipt; read: Read } | null;
  pending: { value: PendingRecord; read: Read } | null;
  /** Bowerloom's own scratch names left by an interrupted create, sorted. */
  scratch: string[];
}
/** Reads `.bowerloom/authoring` with the guards. Any name there other than the records and scratch is unsafe. */
export function readAuthoringState(bowerloom: string): AuthoringState {
  const folder = join(bowerloom, AUTHORING_FOLDER);
  if (lstatOrNull(folder) === null) return { folder: false, receipt: null, pending: null, scratch: [] };
  realFolder(folder);
  const names = folderNames(folder);
  ensure(names.every(n => n === RECEIPT || n === PENDING || SCRATCH.test(n)), 'AUTHORING_UNSAFE_PATH');
  const load = <T>(name: string, parse: (b: Buffer) => T): { value: T; read: Read } | null => {
    if (!names.includes(name)) return null;
    const bytes = readGuarded(join(folder, name), LIMITS.recordBytes);
    return { value: parse(bytes), read: { sha256: sha256(bytes), bytes: bytes.length } };
  };
  return { folder: true, receipt: load(RECEIPT, parseReceipt), pending: load(PENDING, parsePending), scratch: names.filter(n => SCRATCH.test(n)) };
}
