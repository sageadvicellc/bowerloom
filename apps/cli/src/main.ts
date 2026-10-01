#!/usr/bin/env node
import { canonicalJson, DefinitionError } from '../../../packages/contracts/src/index.js';
import { compileCrew } from '../../../packages/crew/src/index.js';

const HELP = `Trellis v0.7-alpha: offline portable definitions

Usage:
  trellis validate <crew.yaml> [--root <directory>]
  trellis plan <crew.yaml> [--root <directory>]

The source root defaults to the directory that contains crew.yaml.
Both commands read source files and print JSON. They start no workers.
The plan records declarations. It grants no runtime permission.
`;

async function main(args: string[]): Promise<void> {
  if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) { process.stdout.write(HELP); return; }
  const [command, file, flag, root] = args;
  if (!['validate', 'plan'].includes(command ?? '') || !file || file.startsWith('-')
    || (args.length !== 2 && (args.length !== 4 || flag !== '--root' || !root || root.startsWith('-')))) {
    throw new DefinitionError('USAGE', 'Use trellis validate <crew.yaml> or trellis plan <crew.yaml>, with optional --root <directory>.');
  }
  const plan = await compileCrew(file, root ? { root } : {});
  const result = command === 'plan' ? plan : {
    valid: true,
    crew: plan.definition.id,
    candidateRevision: plan.candidateRevision,
    tasks: plan.taskOrder.length,
    assets: Object.keys(plan.assets).length,
    runtimeReady: false,
  };
  process.stdout.write(`${canonicalJson(result)}\n`);
}

main(process.argv.slice(2)).catch((error: unknown) => {
  const safeError = error instanceof DefinitionError ? error : new DefinitionError('IO_ERROR', 'Trellis cannot read the declared source.');
  process.stderr.write(`${JSON.stringify({ error: { code: safeError.code, message: safeError.message } })}\n`);
  process.exitCode = safeError.code === 'USAGE' ? 2 : 1;
});
