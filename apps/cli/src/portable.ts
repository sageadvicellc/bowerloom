import { DefinitionError } from '../../../packages/contracts/src/index.js';
import { installBundle, planInstallation, PortableError, validateBundle, type InstallationInput } from '../../../packages/portable/src/index.js';

const usage = (): never => { throw new DefinitionError('USAGE', 'Use bowerloom portable validate <directory>, or plan|install <directory> --select <part,part> --harness codex|claude --target <new-absolute-directory>. Install also requires --approve <revision>.'); };

/** Parse a bounded local install request. Approval never permits crew execution. */
export function runPortableCommand(args: string[]): unknown {
  const [, command, bundleDir, ...flags] = args;
  if (args[0] !== 'portable' || !bundleDir || bundleDir.startsWith('-')) usage();
  if (command === 'validate') {
    if (flags.length) usage();
    return portableResult(() => validateBundle(bundleDir!));
  }
  if (command !== 'plan' && command !== 'install') usage();
  const values = new Map<string, string>();
  for (let index = 0; index < flags.length; index += 2) {
    const key = flags[index], value = flags[index + 1];
    if (!key || !['--select', '--harness', '--target', '--approve'].includes(key)
      || !value || value.startsWith('-') || values.has(key)) usage();
    values.set(key!, value!);
  }
  if (!values.has('--select') || !values.has('--harness') || !values.has('--target')
    || (command === 'install') !== values.has('--approve')) usage();
  const input: InstallationInput = { bundleDir: bundleDir!, selected: values.get('--select')!.split(','), harness: values.get('--harness')!, targetDir: values.get('--target')! };
  return portableResult(() => command === 'plan' ? planInstallation(input) : installBundle(input, values.get('--approve')!));
}

function portableResult(operation: () => unknown): unknown {
  try { return operation(); }
  catch (error) {
    if (error instanceof PortableError) throw new DefinitionError(error.code, 'The portable request stopped. Read the error code and inspect the bundle, target, and current plan before another attempt.');
    throw error;
  }
}
