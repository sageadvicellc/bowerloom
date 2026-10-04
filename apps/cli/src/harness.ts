import { DefinitionError } from '../../../packages/contracts/src/index.js';
import {
  importHarnessConfig, planHarnessProjection, HarnessPortabilityError,
  type Harness, type NeutralConfig,
} from '../../../packages/harness-portability/src/index.js';
import { privateJson } from './controller.js';

function usage(): never {
  throw new DefinitionError('USAGE', 'Use bowerloom harness import|plan --harness codex|claude --file <absolute-fixture-file> --synthetic. Plan also requires --neutral <private-json-file>. These commands read synthetic files and propose changes only.');
}

export async function runHarnessCommand(args: string[]): Promise<unknown> {
  try {
    const [group, command, ...flags] = args;
    if (group !== 'harness' || (command !== 'import' && command !== 'plan')) usage();
    const values = new Map<string, string>();
    let synthetic = false;
    for (let i = 0; i < flags.length; i += 2) {
      const key = flags[i];
      if (key === '--synthetic') {
        if (synthetic) usage();
        synthetic = true; i -= 1; continue;
      }
      const value = flags[i + 1];
      if (!key || !['--harness', '--file', ...(command === 'plan' ? ['--neutral'] : [])].includes(key)
        || !value || value.startsWith('--') || values.has(key)) usage();
      values.set(key, value);
    }
    const harness = values.get('--harness'), file = values.get('--file');
    if (!synthetic || !file || (harness !== 'codex' && harness !== 'claude')) usage();
    const input = { harness: harness as Harness, file, synthetic: true as const };
    if (command === 'import') return await importHarnessConfig(input);
    const neutralFile = values.get('--neutral');
    if (!neutralFile) usage();
    const neutral = await privateJson(neutralFile, 16384) as NeutralConfig;
    return await planHarnessProjection({ ...input, neutral });
  } catch (error) {
    if (error instanceof DefinitionError) throw error;
    if (error instanceof HarnessPortabilityError) {
      throw new DefinitionError(error.code, 'Harness planning stopped. Read the supported-field report and use an unchanged synthetic source.');
    }
    throw new DefinitionError('HARNESS_IO', 'Harness planning failed to read the selected files. Use regular private JSON for neutral preferences and synthetic harness files.');
  }
}
