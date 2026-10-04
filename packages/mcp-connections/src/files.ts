import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, parse, resolve } from 'node:path';
import { strictJson } from '../../codex-adapter/src/safe.js';
import { canonicalJson } from '../../contracts/src/index.js';
import { data, fail, MAX_DOCUMENT_BYTES, McpConnectionError, planMcpConnection, sha256 } from './model.js';
import type { McpConnectionPlan } from './model.js';

export interface McpFilesInput { declarationFile: string; bindingFile: string; catalogFile: string; synthetic: true }
export interface SourcePin {
  file: string; sha256: string; bytes: number;
  identity: { device: string; inode: string; birthtimeNs: string; mtimeNs: string; ctimeNs: string; uid: number; mode: number };
}
export interface McpFilePlan extends Omit<McpConnectionPlan, 'revision'> {
  sourcePins: { declaration: SourcePin; binding: SourcePin; catalog: SourcePin };
  contentRevision: string; revision: string;
}
function path(value: unknown): string {
  if (typeof value !== 'string' || !isAbsolute(value) || resolve(value) !== value || value !== value.normalize('NFC')
    || Buffer.byteLength(value) > 2048 || /[\p{Cc}\p{Cf}\\]/u.test(value) || !value.endsWith('.json')) fail('MCP_SOURCE_PATH');
  const parts = value.toLowerCase().split('/');
  if (parts.some(part => ['.codex', '.claude', '.ssh', '.aws', '.azure', '.gnupg', '.config', 'library', '.git'].includes(part)
    || part.includes('nmaahc-sm') || /^\.env(?:\.|$)/.test(part)
    || /^(?:auth|credentials?|secrets?|tokens?|passwords?|id_rsa|id_ed25519)(?:\.|$)/.test(part))
    || /^\/(?:etc|var\/root|usr|bin|sbin|system)(?:\/|$)/i.test(value)
    || ['.claude.json', '.credentials.json', 'managed-settings.json'].includes(parts.at(-1)!)) fail('MCP_PROTECTED_PATH');
  return value;
}
async function directories(file: string, privateSource: boolean): Promise<string> {
  const parent = dirname(file); if (await realpath(parent) !== parent) fail('MCP_SOURCE_SYMLINK');
  const pins = [];
  for (let at = parent;; at = dirname(at)) {
    const s = await lstat(at, { bigint: true }), mode = Number(s.mode) & 0o7777;
    if (!s.isDirectory() || s.isSymbolicLink()) fail('MCP_SOURCE_DIRECTORY');
    if (Number(s.uid) !== process.getuid?.() && Number(s.uid) !== 0) fail('MCP_SOURCE_OWNER');
    if ((mode & 0o022) && !(Number(s.uid) === 0 && (mode & 0o1000))) fail('MCP_SOURCE_DIRECTORY_MODE');
    if (at === parent && (Number(s.uid) !== process.getuid?.() || (privateSource && (mode & 0o077)))) fail('MCP_SOURCE_PRIVATE_DIRECTORY');
    pins.push({ path: at, dev: String(s.dev), ino: String(s.ino), birth: String(s.birthtimeNs), uid: Number(s.uid), mode });
    if (at === parse(at).root) break;
  }
  return canonicalJson(pins);
}
function identity(s: { dev: bigint; ino: bigint; birthtimeNs: bigint; mtimeNs: bigint; ctimeNs: bigint; uid: bigint; mode: bigint }): SourcePin['identity'] {
  return { device: String(s.dev), inode: String(s.ino), birthtimeNs: String(s.birthtimeNs), mtimeNs: String(s.mtimeNs), ctimeNs: String(s.ctimeNs), uid: Number(s.uid), mode: Number(s.mode) & 0o7777 };
}
async function read(file: string, privateSource: boolean): Promise<{ value: unknown; pin: SourcePin; dirs: string }> {
  const dirs = await directories(file, privateSource);
  const named = await lstat(file, { bigint: true });
  if (named.isSymbolicLink()) fail('MCP_SOURCE_SYMLINK');
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.nlink !== 1n || Number(before.uid) !== process.getuid?.()
      || Number(before.mode) & (privateSource ? 0o7177 : 0o7133)) fail('MCP_SOURCE_UNSAFE');
    if (before.size > BigInt(MAX_DOCUMENT_BYTES)) fail('MCP_SOURCE_BOUND');
    if (canonicalJson(identity(before)) !== canonicalJson(identity(named))) fail('MCP_SOURCE_CHANGED');
    const buffer = Buffer.alloc(MAX_DOCUMENT_BYTES + 1); let length = 0;
    for (;;) { const got = await handle.read(buffer, length, buffer.length - length, null); if (!got.bytesRead) break; length += got.bytesRead; if (length > MAX_DOCUMENT_BYTES) fail('MCP_SOURCE_BOUND'); }
    const after = await handle.stat({ bigint: true }), current = await lstat(file, { bigint: true });
    if (BigInt(length) !== before.size || canonicalJson(identity(before)) !== canonicalJson(identity(after))
      || canonicalJson(identity(before)) !== canonicalJson(identity(current)) || current.isSymbolicLink() || current.nlink !== 1n
      || dirs !== await directories(file, privateSource)) fail('MCP_SOURCE_CHANGED');
    const bytes = buffer.subarray(0, length); let text: string;
    try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); } catch { return fail('MCP_SOURCE_UTF8'); }
    if (text.startsWith('\uFEFF')) fail('MCP_SOURCE_UTF8');
    let value: unknown; try { value = strictJson(text, MAX_DOCUMENT_BYTES); } catch { return fail('MCP_SOURCE_JSON'); }
    return { value, pin: { file, sha256: sha256(bytes), bytes: length, identity: identity(before) }, dirs };
  } finally { await handle.close(); }
}
export async function planMcpConnectionFiles(value: McpFilesInput): Promise<McpFilePlan> {
  try {
    const v = data(value) as Record<string, unknown>;
    if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).length !== 4
      || !['declarationFile', 'bindingFile', 'catalogFile', 'synthetic'].every(key => Object.hasOwn(v, key)) || v.synthetic !== true) fail('MCP_SYNTHETIC_REQUIRED');
    const files = [path(v.declarationFile), path(v.bindingFile), path(v.catalogFile)];
    if (new Set(files).size !== files.length) fail('MCP_SOURCE_DUPLICATE');
    const declaration = await read(files[0]!, false), binding = await read(files[1]!, true), catalog = await read(files[2]!, true);
    const content = planMcpConnection({ declaration: declaration.value, binding: binding.value, catalog: catalog.value, synthetic: true });
    for (const [index, source] of [declaration, binding, catalog].entries()) {
      const again = await read(source.pin.file, index !== 0);
      if (canonicalJson(again.pin) !== canonicalJson(source.pin) || again.dirs !== source.dirs) fail('MCP_SOURCE_CHANGED');
    }
    const { revision: contentRevision, ...plan } = content;
    const body = { ...plan, sourcePins: { declaration: declaration.pin, binding: binding.pin, catalog: catalog.pin }, contentRevision };
    return { ...body, revision: 'sha256:' + sha256(canonicalJson(body)) };
  } catch (error) { if (error instanceof McpConnectionError) throw error; return fail('MCP_SOURCE_UNAVAILABLE'); }
}
