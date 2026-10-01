#!/usr/bin/env node
import { canonicalJson, DefinitionError } from '../../../packages/contracts/src/index.js';
import { localInstallation, privateJson, openLocalSession } from './controller.js';
import { executeSession, parseSessionCommand } from './session.js';
import type { TestExecutor } from '../../../packages/controlled-tests/src/index.js';
import { compileCrew } from '../../../packages/crew/src/index.js';

const HELP = `Trellis v0.7-alpha: local controlled workflows

Usage:
  trellis validate <crew.yaml> [--root <directory>]
  trellis plan <crew.yaml> [--root <directory>]
  trellis up --demo --pro|--5x|--20x --installation <private.json>
  trellis status|review|cancel --installation <private.json>
  trellis approve --installation <private.json> --candidate <sha256:...> --action <sha256:...>

The source root defaults to the directory that contains crew.yaml.
Validate and plan read source files and print JSON. They start no workers.
Status and review read the prepared session without a model or browser.
Up stops for exact approval. Approve writes and tests the stored proposal.
Tier flags do not promise measured throughput. Alpha runs tasks sequentially.
The plan records declarations. It grants no runtime permission.
`;

async function main(args: string[]): Promise<void> {
  if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) { process.stdout.write(HELP); return; }
  if (['up','status','review','approve','cancel'].includes(args[0] ?? '')) {
    const command=parseSessionCommand(args),config=localInstallation(await privateJson(command.installation));
    const readOnly=command.command==='status'||command.command==='review';
    const signal=new AbortController();const abort=()=>signal.abort();
    process.once('SIGINT',abort);process.once('SIGTERM',abort);
    try {
      let executor:TestExecutor;
      if(readOnly)executor={async execute(){throw new DefinitionError('READ_ONLY_COMMAND','This command cannot start a browser.');},async reap(){throw new DefinitionError('READ_ONLY_COMMAND','This command owns no browser operation.');}};
      else {
        const {LinuxBrowserExecutor}=await import('../../../packages/linux-browser/src/index.js');
        const load=async()=>{
          const browser=await LinuxBrowserExecutor.open(config.browser);
          if(browser.manifest!==config.graph.assets['test-manifest'])throw new DefinitionError('TEST_MANIFEST_MISMATCH','The installed browser does not match the pinned test manifest.');
          return browser;
        };
        executor=command.command==='cancel'?{
          async execute(){throw new DefinitionError('CANCEL_ONLY','Cancellation cannot start a browser test.');},
          async reap(operationId){await(await load()).reap(operationId);},
        }:await load();
      }
      const port=await openLocalSession(config,executor,readOnly?'read':command.command==='cancel'?'cancel':'start');
      await executeSession(command,port,value=>process.stdout.write(`${canonicalJson(value)}\n`),signal.signal);
    } finally { process.removeListener('SIGINT',abort);process.removeListener('SIGTERM',abort); }
    return;
  }
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
  const code=error!==null&&typeof error==='object'&&'code' in error&&typeof error.code==='string'&&/^[A-Z_]{1,100}$/.test(error.code)?error.code:'IO_ERROR';
  const safeError = error instanceof DefinitionError ? error : new DefinitionError(code, 'Trellis stopped. Read the local session state before another action.');
  process.stderr.write(`${JSON.stringify({ error: { code: safeError.code, message: safeError.message } })}\n`);
  process.exitCode = safeError.code === 'USAGE' ? 2 : 1;
});
