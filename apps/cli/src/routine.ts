import { types } from 'node:util';
import { DefinitionError } from '../../../packages/contracts/src/index.js';
import { loadRoutineFiles, RoutineFilesError } from '../../../packages/routines/src/files.js';
import type { RoutineFilesResult } from '../../../packages/routines/src/files.js';

const USAGE = 'Use bowerloom routine plan --root <absolute-.bowerloom-directory> --experiment-id <logical-id> --experiment-digest <sha256:hex>. This reads a standalone authoring tree; it does not install or execute it.';
const REFUSAL = 'The routine plan was refused. Review the selected local definition and dependency pins. No files were installed and no execution authority was granted.';
const FAILURE = 'The routine plan could not be read. No files were installed and no execution authority was granted.';
const LOADER_CODES = new Set(['INPUT', 'BOUND', 'YAML', 'DEFINITION', 'PATH', 'UNAVAILABLE', 'UNSAFE', 'CHANGED', 'DEPENDENCY'].map(code => `ROUTINE_FILES_${code}`));
function usage(): never { throw new DefinitionError('USAGE', USAGE); }
function tokens(args: string[]): string[] {
  if (!Array.isArray(args) || types.isProxy(args) || args.length !== 8) usage();
  const result: string[] = [];
  for (let i = 0; i < 8; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(args, String(i));
    if (!descriptor || !('value' in descriptor) || typeof descriptor.value !== 'string') usage();
    const value: string = descriptor.value;
    if (value.length > 2048 || Buffer.byteLength(value) > 2048) usage();
    result.push(value);
  }
  return result;
}
function refusal(error: unknown): DefinitionError {
  // Foreign errors may be Proxies or contain throwing getters. Never copy their message/cause.
  try {
    if (error && typeof error === 'object' && !types.isProxy(error) && Object.getPrototypeOf(error) === RoutineFilesError.prototype) {
      const code = Object.getOwnPropertyDescriptor(error, 'code');
      if (code && 'value' in code && typeof code.value === 'string' && LOADER_CODES.has(code.value)) return new DefinitionError(code.value, REFUSAL);
    }
  } catch { /* Refuse unknown exception shape without consulting any other property. */ }
  return new DefinitionError('ROUTINE_READ_FAILED', FAILURE);
}
export async function runRoutineCommand(args: string[]): Promise<RoutineFilesResult> {
  const captured = tokens(args);
  if (captured[0] !== 'routine' || captured[1] !== 'plan') usage();
  const values = new Map<string, string>();
  for (let i = 2; i < 8; i += 2) {
    const flag = captured[i]!, value = captured[i + 1]!;
    if (!['--root', '--experiment-id', '--experiment-digest'].includes(flag) || values.has(flag) || !value || value.startsWith('-')) usage();
    values.set(flag, value);
  }
  if (values.size !== 3) usage();
  try {
    return await loadRoutineFiles(values.get('--root')!, { experiment: { id: values.get('--experiment-id')!, digest: values.get('--experiment-digest')! } });
  } catch (error) { throw refusal(error); }
}
