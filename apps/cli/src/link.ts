import { applyLink, planLink, readLink, revokeLink, ConnectionError, renderLinkReview } from '../../../packages/connections/src/index.js';
import { DefinitionError } from '../../../packages/contracts/src/index.js';
export { renderLinkReview };
const usage = (): never => { throw new DefinitionError('USAGE', 'Use link plan|apply --from <root> --to <root> --file <definition> --out <private-new-file> [--approve <revision>] [--json]. Use link read --connection <file> --target <root>, or link revoke --connection <file>.'); };
export async function runLinkCommand(args: string[]): Promise<unknown> {
  try {
    const [, command, ...flags] = args;
    if (args[0] !== 'link' || !['plan', 'apply', 'read', 'revoke'].includes(command ?? '')) usage();
    const values = new Map<string, string>(); let json = false;
    const allowed = command === 'read' ? ['--connection', '--target'] : command === 'revoke' ? ['--connection'] : ['--from', '--to', '--file', '--out', ...(command === 'apply' ? ['--approve'] : [])];
    for (let i = 0; i < flags.length; i++) {
      const flag = flags[i]!;
      if (flag === '--json' && command === 'plan' && !json) { json = true; continue; }
      const value = flags[++i];
      if (!allowed.includes(flag) || values.has(flag) || !value || value.startsWith('--')) usage();
      values.set(flag, value!);
    }
    if (allowed.some(flag => !values.has(flag))) usage();
    if (command === 'read') return await readLink(values.get('--connection')!, values.get('--target')!);
    if (command === 'revoke') return await revokeLink(values.get('--connection')!);
    const input = { from: values.get('--from')!, to: values.get('--to')!, file: values.get('--file')!, output: values.get('--out')! };
    return command === 'plan' ? await planLink(input) : await applyLink(input, values.get('--approve')!);
  } catch (error) {
    if (error instanceof ConnectionError) throw new DefinitionError(error.code, 'The connection stopped. Read the selected paths and approval revision before another attempt.');
    if (error instanceof DefinitionError) throw error;
    throw new DefinitionError('LINK_IO', 'The connection could not read or save its files. No execution permission was granted.');
  }
}
