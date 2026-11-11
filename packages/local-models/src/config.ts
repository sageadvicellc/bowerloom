/**
 * The local models file: `local-models.json` in the state folder, `{ "endpoints": [{ "provider": "llama-server", "port": 8091 }] }`. Configured endpoints come first. The three
 * well-known ports are added after them, as endpoints that are not configured: when one of those does not answer, the report omits it, so the screen is not a wall of "down".
 * There is no port scan. The file is read again on every call, so an edit shows at the next probe. The file is read only: nothing here writes it.
 *
 * Nothing in a result holds a path or a refused address, only short codes and fixed words.
 */
import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkEndpoint } from './guard.js';
import type { ProviderId, LocalModelsNote } from './types.js';

export const CONFIG_FILE_NAME = 'local-models.json';
/** The most endpoints probed at once, configured and default together. */
export const MAX_ENDPOINTS = 8;
/** A larger file is not a settings file. */
const MAX_FILE_BYTES = 16 * 1024;

export interface EndpointSpec {
  readonly provider: ProviderId;
  readonly port: number;
  /** True when the person wrote it in the file. False for a well-known default. */
  readonly configured: boolean;
}

export const WELL_KNOWN_ENDPOINTS: readonly EndpointSpec[] = Object.freeze([
  Object.freeze({ provider: 'llama-server' as const, port: 8080, configured: false }),
  Object.freeze({ provider: 'ollama' as const, port: 11434, configured: false }),
  Object.freeze({ provider: 'lm-studio' as const, port: 1234, configured: false }),
]);

export interface EndpointConfig {
  readonly endpoints: readonly EndpointSpec[];
  /** How many endpoints the file holds, after the refused ones are left out. */
  readonly endpointsConfigured: number;
  readonly notes: readonly LocalModelsNote[];
  /** True when the file exists and could not be read as a settings file. No endpoint is probed then. */
  readonly unreadable: boolean;
}

const REFUSED_TEXT: Readonly<Record<string, string>> = Object.freeze({
  NOT_LOOPBACK: 'An endpoint in the local models file names a host other than 127.0.0.1. It was left out. An endpoint is a port on this computer.',
  BAD_PORT: 'An endpoint in the local models file has a port that is not a number from 1 to 65535. It was left out.',
  UNKNOWN_PROVIDER: 'An endpoint in the local models file names a server kind that is not known. It was left out.',
  BAD_ENDPOINT: 'An entry in the local models file is not an endpoint with a provider and a port. It was left out.',
});

const frozen = (endpoints: EndpointSpec[], endpointsConfigured: number, notes: LocalModelsNote[], unreadable: boolean): EndpointConfig =>
  Object.freeze({ endpoints: Object.freeze(endpoints), endpointsConfigured, notes: Object.freeze(notes.map(n => Object.freeze(n))), unreadable });

const unreadableConfig = (): EndpointConfig =>
  frozen([], 0, [{ code: 'CONFIG_UNREADABLE', text: 'The local models file could not be read, so no server was probed.' }], true);

const withDefaults = (configured: EndpointSpec[], notes: LocalModelsNote[]): EndpointConfig => {
  const endpoints = [...configured];
  for (const known of WELL_KNOWN_ENDPOINTS) {
    if (endpoints.length >= MAX_ENDPOINTS) break;
    if (!endpoints.some(e => e.provider === known.provider && e.port === known.port)) endpoints.push(known);
  }
  return frozen(endpoints, configured.length, notes, false);
};

/** Reads the file in the state folder. It never throws. */
export function readEndpointConfig(stateRoot: unknown): EndpointConfig {
  if (typeof stateRoot !== 'string' || stateRoot === '') return unreadableConfig();
  const file = join(stateRoot, CONFIG_FILE_NAME);
  let text: string;
  try {
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return unreadableConfig();
    text = readFileSync(file, 'utf8');
  } catch (error) {
    const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
    return code === 'ENOENT' || code === 'ENOTDIR' ? withDefaults([], []) : unreadableConfig();
  }
  let parsed: unknown;
  try { parsed = JSON.parse(text.startsWith('﻿') ? text.slice(1) : text) as unknown; } catch { return unreadableConfig(); }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return unreadableConfig();
  const list = (parsed as { endpoints?: unknown }).endpoints;
  if (!Array.isArray(list)) return unreadableConfig();

  const configured: EndpointSpec[] = [];
  const notes: LocalModelsNote[] = [];
  const noted = new Set<string>();
  const note = (code: string, noteText: string): void => { if (!noted.has(code)) { noted.add(code); notes.push({ code, text: noteText }); } };
  for (const entry of list as readonly unknown[]) {
    const checked = checkEndpoint(entry);
    if (!checked.ok) { note(`ENDPOINT_REFUSED_${checked.code}`, REFUSED_TEXT[checked.code] as string); continue; }
    if (configured.some(e => e.provider === checked.provider && e.port === checked.port)) continue;
    if (configured.length >= MAX_ENDPOINTS) { note('TOO_MANY_ENDPOINTS', `The local models file holds more than ${MAX_ENDPOINTS} endpoints. Only the first ${MAX_ENDPOINTS} are probed.`); continue; }
    configured.push({ provider: checked.provider, port: checked.port, configured: true });
  }
  return withDefaults(configured, notes);
}
