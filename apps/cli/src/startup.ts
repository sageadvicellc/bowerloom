import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DefinitionError } from '../../../packages/contracts/src/index.js';
import { strictJson } from '../../../packages/codex-adapter/src/safe.js';
import { planStartup, applyStartup, inspectStartup, StartupError, type StartupInput } from '../../../packages/startup/src/index.js';

export { renderStartupReview } from '../../../packages/startup/src/index.js';

const usage = (): never => { throw new DefinitionError('USAGE', 'Use bowerloom init plan|apply --mode new|existing --target <absolute-directory> with --brief <brief.json> or --name <name> --goal <goal>, with --profile engineer|founder|research. Plan supports --json. Apply requires --approve <revision>. Use init status --target <directory> to inspect installed files.'); };

async function readBrief(file: string): Promise<StartupInput['brief']> {
  const path = resolve(file);
  if (await realpath(path) !== path) throw new DefinitionError('UNSAFE_BRIEF', 'Use a regular brief file without symbolic links.');
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > 16384) throw new DefinitionError('INVALID_BRIEF', 'Use a regular JSON brief file of at most 16 KiB.');
    const buffer = Buffer.alloc(16385);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    const after = await handle.stat();
    if (length > 16384 || length !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) {
      throw new DefinitionError('BRIEF_CHANGED', 'The brief changed during the read. Read it before another attempt.');
    }
    try { return strictJson(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length)), 16384) as StartupInput['brief']; }
    catch { throw new DefinitionError('INVALID_BRIEF', 'Use UTF-8 JSON with unique keys for the project brief.'); }
  } finally { await handle.close(); }
}

async function dispatchStartup(args: string[]): Promise<unknown> {
  const [, command, ...flags] = args;
  if (args[0] !== 'init' || !['plan', 'apply', 'status'].includes(command ?? '')) usage();
  const values = new Map<string, string>();
  const allowed = command === 'status' ? ['--target'] : ['--mode', '--target', '--brief', '--name', '--goal', '--assistant', '--team', '--review', '--profile', '--approve'];
  let jsonRequested = false;
  for (let i = 0; i < flags.length; i += 2) {
    if (flags[i] === '--json') {
      if (command !== 'plan' || jsonRequested) usage();
      jsonRequested = true; i -= 1; continue;
    }
    const key = flags[i], value = flags[i + 1];
    if (!key || !allowed.includes(key) || !value || value.startsWith('--') || values.has(key)) usage();
    values.set(key!, value!);
  }
  if (!values.has('--target')) usage();
  if (command === 'status') return inspectStartup(values.get('--target')!);
  const mode = values.get('--mode');
  if (mode !== 'new' && mode !== 'existing') usage();
  if ((command === 'apply') !== values.has('--approve')) usage();
  const inline = ['--name', '--goal', '--assistant', '--team', '--review', '--profile'];
  if (values.has('--brief') && inline.some(key => values.has(key))) usage();
  if (!values.has('--brief') && (!values.has('--name') || !values.has('--goal'))) usage();
  const reviewMode = values.get('--review');
  if (reviewMode !== undefined && reviewMode !== 'milestones' && reviewMode !== 'handoff') usage();
  const brief: StartupInput['brief'] = values.has('--brief') ? await readBrief(values.get('--brief')!) : {
    projectName: values.get('--name')!, goal: values.get('--goal')!,
    ...(values.has('--profile') ? { profile: values.get('--profile')! as NonNullable<StartupInput['brief']['profile']> } : {}),
    ...(values.has('--assistant') ? { assistantName: values.get('--assistant')! } : {}),
    ...(values.has('--team') ? { teamName: values.get('--team')! } : {}),
    ...(reviewMode ? { reviewMode: reviewMode as 'milestones' | 'handoff' } : {}),
  };
  const input: StartupInput = { mode: mode as StartupInput['mode'], targetDir: values.get('--target')!, brief };
  return command === 'plan' ? planStartup(input) : applyStartup(input, values.get('--approve')!);
}

export async function runStartupCommand(args: string[]): Promise<unknown> {
  try { return await dispatchStartup(args); }
  catch (error) {
    if (error instanceof StartupError) {
      throw new DefinitionError(error.code, 'Startup stopped. Read the error code, project brief, and target directory. Create a new plan after a change.');
    }
    if (error instanceof DefinitionError) throw error;
    throw new DefinitionError('STARTUP_IO', 'Startup failed to read or write the selected files. Inspect the paths and permissions before another attempt.');
  }
}
