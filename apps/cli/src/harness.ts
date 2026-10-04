import { DefinitionError } from '../../../packages/contracts/src/index.js';
import {
  importHarnessConfig, planHarnessProjection, HarnessPortabilityError,
  planManagedProjection, applyManagedProjection, planProjectionRemoval,
  removeManagedProjection, recoverManagedProjection,
  type Harness, type NeutralConfig,
} from '../../../packages/harness-portability/src/index.js';
import { privateJson } from './controller.js';

function usage(): never {
  throw new DefinitionError('USAGE', 'Use bowerloom harness import|plan|managed-plan|apply --harness codex|claude --file <absolute-fixture-file> --synthetic. Plans require --neutral <private-json-file>. Managed plans and apply also require --state <new-private-directory>. Apply requires --approve <exact-plan-revision>. Use removal-plan|remove|recover with --state and --synthetic. Remove and recover require --approve <exact-operation-revision>.');
}

export async function runHarnessCommand(args: string[]): Promise<unknown> {
  try {
    const [group, command, ...flags] = args;
    if (group !== 'harness' || !['import', 'plan', 'managed-plan', 'apply', 'removal-plan', 'remove', 'recover'].includes(command ?? '')) usage();
    const stateOnly = command === 'removal-plan' || command === 'remove' || command === 'recover';
    const writes = command === 'apply' || command === 'remove' || command === 'recover';
    const allowed = stateOnly ? ['--state', ...(writes ? ['--approve'] : [])]
      : ['--harness', '--file', ...(command !== 'import' ? ['--neutral'] : []),
        ...(command === 'managed-plan' || command === 'apply' ? ['--state'] : []), ...(writes ? ['--approve'] : [])];
    const values = new Map<string, string>();
    let synthetic = false;
    for (let i = 0; i < flags.length; i += 2) {
      const key = flags[i];
      if (key === '--synthetic') {
        if (synthetic) usage();
        synthetic = true; i -= 1; continue;
      }
      const value = flags[i + 1];
      if (!key || !allowed.includes(key)
        || !value || value.startsWith('--') || values.has(key)) usage();
      values.set(key, value);
    }
    if (!synthetic || (writes && !values.has('--approve'))) usage();
    if (stateOnly) {
      const stateDir = values.get('--state');
      if (!stateDir) usage();
      if (command === 'removal-plan') return await planProjectionRemoval({ stateDir });
      if (command === 'remove') return await removeManagedProjection({ stateDir }, values.get('--approve')!);
      return await recoverManagedProjection({ stateDir }, values.get('--approve')!);
    }
    const harness = values.get('--harness'), file = values.get('--file');
    if (!synthetic || !file || (harness !== 'codex' && harness !== 'claude')) usage();
    const input = { harness: harness as Harness, file, synthetic: true as const };
    if (command === 'import') return await importHarnessConfig(input);
    const neutralFile = values.get('--neutral');
    if (!neutralFile) usage();
    const neutral = await privateJson(neutralFile, 16384) as NeutralConfig;
    if (command === 'plan') return await planHarnessProjection({ ...input, neutral });
    const stateDir = values.get('--state');
    if (!stateDir) usage();
    const managed = { ...input, neutral, stateDir };
    return command === 'managed-plan' ? await planManagedProjection(managed)
      : await applyManagedProjection(managed, values.get('--approve')!);
  } catch (error) {
    if (error instanceof DefinitionError) throw error;
    if (error instanceof HarnessPortabilityError) {
      throw new DefinitionError(error.code, 'The harness command stopped. Inspect the synthetic source and any recorded transaction before another attempt.');
    }
    throw new DefinitionError('HARNESS_IO', 'The harness command failed to access the selected files. Inspect the paths and any recorded transaction before another attempt.');
  }
}
