#!/usr/bin/env node
import { canonicalJson, DefinitionError } from '../../../packages/contracts/src/index.js';
import { localInstallation, privateJson, openLocalSession } from './controller.js';
import { executeSession, parseSessionCommand } from './session.js';
import type { TestExecutor } from '../../../packages/controlled-tests/src/index.js';
import { compileCrew } from '../../../packages/crew/src/index.js';
import { compileAuthoring } from '../../../packages/authoring/src/index.js';

const HELP = `Bowerloom v0.7-alpha: local controlled workflows

Usage:
  bowerloom init plan|apply --mode new|existing --target <absolute-directory> --name <project-name> --goal <goal> [--assistant <name>] [--team <name>] [--review milestones|handoff] [--approve <revision>]
  bowerloom init plan|apply --mode new|existing --target <absolute-directory> --brief <brief.json> [--approve <revision>]
  bowerloom init status --target <absolute-directory>
  bowerloom init demo-plan --target <absolute-directory> --from <installed-revision> [--json]
  bowerloom revise plan|apply --target <directory> --brief <brief.json> [--from <installed-revision> --approve <plan-revision>]
  bowerloom revise recover --target <directory> --approve <plan-revision> --action resume|rollback
  bowerloom harness import|plan --harness codex|claude --file <absolute-fixture-file> --synthetic [--neutral <private-json-file>]
  bowerloom harness managed-plan|apply --harness codex|claude --file <absolute-fixture-file> --neutral <private-json-file> --state <new-private-directory> --synthetic [--approve <revision>]
  bowerloom harness removal-plan|remove|recover --state <private-directory> --synthetic [--approve <revision>]
  bowerloom link plan|apply --from <root> --to <root> --file <definition> --out <private-new-file> [--approve <revision>]
  bowerloom link read --connection <file> --target <receiving-root>
  bowerloom link revoke --connection <file>
  bowerloom control plan|register --root <root> --team <id> --spec <relative-team-file> [--adapter graph|recipe --installation <private.json>] [--registry <directory>] [--approve <revision>]
  bowerloom destruct <team-id> --root <root> [--registry <directory>] [--timeout-ms <milliseconds>]
  bowerloom destruct all [--registry <directory>] [--timeout-ms <milliseconds>]
  bowerloom backend doctor
  bowerloom backend plan|install --root <new-absolute-directory> [--studio-port <port>] [--database-port <port>] [--approve <revision>]
  bowerloom backend status --root <private-installation-directory>
  bowerloom portable validate <bundle-directory>
  bowerloom portable plan|install <bundle-directory> --select <part,part> --harness codex --target <new-absolute-directory> [--approve <revision>]
  bowerloom recipe inspect|setup --installation <private.json>
  bowerloom recipe plan|review|approve|run|reconcile|cancel|status --installation <private.json> --input <request.json>
  bowerloom validate <crew.yaml> [--root <directory>]
  bowerloom plan <crew.yaml> [--root <directory>]
  bowerloom authoring validate|export <authoring.json> --scenario <frozen-scenario.json> [--root <directory>]
  bowerloom up --demo --pro|--5x|--20x --installation <private.json>
  bowerloom status|review|cancel --installation <private.json>
  bowerloom approve --installation <private.json> --candidate <sha256:...> --action <sha256:...>

The trellis and trellis-mcp commands remain compatibility aliases.
Init prepares a personal-agent profile and first team specification from your brief.
Init apply requires the exact plan revision. It starts no workers or backend services.
Init plan offers a plain-English review. Add --json for the complete machine-readable plan.
Init demo-plan offers an optional synthetic Workbench handoff. It does not execute the installed team or grant action approval.
Revise plans changes to an installed specification. Apply requires the old revision and exact new approval.
Revision recovery resumes the approved transaction or restores its recorded prior installation. It starts no workers.
Harness import and plan are for synthetic files. They do not install settings, connect tools, or start a team.
Harness apply and remove require separate exact approvals. They change only the selected synthetic configuration and retain recovery records.
Harness recover requires the exact recorded operation approval. No harness command grants model execution authority.
Choose --profile engineer|founder|research, or set profile in the brief.
Links share one approved definition between installed local roots. They grant no execution authority.
Destruct stops registered Bowerloom work and preserves project files, definitions, and saved state.
Destruct all covers one local registry, not other users, remote machines, or unrelated agent sessions.
Existing mode adds .bowerloom only. Claude and Codex settings import belongs to beta.
Backend install requires --approve with the exact current plan revision.
Backend setup uses a separate local Supabase profile. It provisions no agent runtime.
Docker Desktop is a prerequisite. The CLI never installs privileged host software.
Portable install requires --approve with the exact current plan revision.
Portable installation copies selected files. It starts no workers.
The source root defaults to the directory that contains crew.yaml.
Validate and plan read source files and print JSON. They start no workers.
Status and review read the prepared session without a model or browser.
Up stops for exact approval. Approve writes and tests the stored proposal.
Tier flags do not promise measured throughput. Alpha runs tasks sequentially.
The plan records declarations. It grants no runtime permission.
Recipe commands share their controller with MCP. The operator CLI owns exact approval.
`;

async function main(args: string[]): Promise<void> {
  if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) { process.stdout.write(HELP); return; }
  if (args[0] === 'init') {
    const { runStartupCommand, renderStartupReview, renderStartupDemoReview } = await import('./startup.js');
    const result = await runStartupCommand(args);
    process.stdout.write(args[1] === 'demo-plan' && !args.includes('--json')
      ? renderStartupDemoReview(result as import('../../../packages/startup/src/index.js').StartupDemoPlan)
      : args[1] === 'plan' && !args.includes('--json')
      ? renderStartupReview(result as import('../../../packages/startup/src/index.js').StartupPlan)
      : `${canonicalJson(result)}\n`);
    return;
  }
  if (args[0] === 'link') {
    const { runLinkCommand, renderLinkReview } = await import('./link.js');
    const result = await runLinkCommand(args);
    process.stdout.write(args[1] === 'plan' && !args.includes('--json')
      ? renderLinkReview(result as import('../../../packages/connections/src/index.js').LinkPlan)
      : `${canonicalJson(result)}\n`);
    return;
  }
  if (args[0] === 'revise') {
    const { runRevisionCommand, renderStartupRevisionReview } = await import('./revision.js');
    const result = await runRevisionCommand(args);
    process.stdout.write(args[1] === 'plan' && !args.includes('--json')
      ? renderStartupRevisionReview(result as import('../../../packages/startup/src/index.js').StartupRevisionPlan)
      : `${canonicalJson(result)}\n`);
    return;
  }
  if (args[0] === 'harness') {
    const { runHarnessCommand } = await import('./harness.js');
    process.stdout.write(`${canonicalJson(await runHarnessCommand(args))}\n`);
    return;
  }
  if (args[0] === 'control') {
    const { runControlCommand } = await import('./control.js');
    process.stdout.write(`${canonicalJson(await runControlCommand(args))}\n`);
    return;
  }
  if (args[0] === 'destruct') {
    const { runDestructCommand } = await import('./destruct.js');
    process.stdout.write(`${canonicalJson(await runDestructCommand(args))}\n`);
    return;
  }
  if (args[0] === 'backend') {
    const { runBackendCommand } = await import('./backend.js');
    process.stdout.write(`${canonicalJson(await runBackendCommand(args))}\n`);
    return;
  }
  if (args[0] === 'portable') {
    const { runPortableCommand } = await import('./portable.js');
    process.stdout.write(`${canonicalJson(runPortableCommand(args))}\n`);
    return;
  }
  if (args[0] === 'recipe') {
    const { runRecipeCommand } = await import('./recipe.js');
    process.stdout.write(`${canonicalJson(await runRecipeCommand(args))}\n`);
    return;
  }
  if (args[0] === 'authoring') {
    const [, command, file, flag, scenario, rootFlag, root] = args;
    if (!['validate','export'].includes(command ?? '') || !file || file.startsWith('-') || flag !== '--scenario'
      || !scenario || scenario.startsWith('-') || (args.length !== 5 && (args.length !== 7 || rootFlag !== '--root' || !root || root.startsWith('-')))) {
      throw new DefinitionError('USAGE', 'Use bowerloom authoring validate|export <authoring.json> --scenario <frozen-scenario.json>, with optional --root.');
    }
    const bundle = await compileAuthoring(file, { scenarioFile: scenario, ...(root ? { root } : {}) });
    process.stdout.write(`${canonicalJson(command === 'export' ? bundle : {
      valid: true, authoringRevision: bundle.authoringRevision, candidateRevision: bundle.plan.candidateRevision,
      scenarioDigest: bundle.scenarioDigest, tasks: bundle.plan.taskOrder.length, executionAuthorized: false,
    })}\n`);
    return;
  }
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
      const port=await openLocalSession(config,executor,readOnly?'read':command.command==='cancel'?'cancel':'start', {
        installationPath: command.installation, ...(command.registry ? { registry: command.registry } : {}),
      });
      await executeSession(command,port,value=>process.stdout.write(`${canonicalJson(value)}\n`),signal.signal);
    } finally { process.removeListener('SIGINT',abort);process.removeListener('SIGTERM',abort); }
    return;
  }
  const [command, file, flag, root] = args;
  if (!['validate', 'plan'].includes(command ?? '') || !file || file.startsWith('-')
    || (args.length !== 2 && (args.length !== 4 || flag !== '--root' || !root || root.startsWith('-')))) {
    throw new DefinitionError('USAGE', 'Use bowerloom validate <crew.yaml> or trellis plan <crew.yaml>, with optional --root <directory>.');
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
  const safeError = error instanceof DefinitionError ? error : new DefinitionError(code, 'Bowerloom stopped. Read the local session state before another action.');
  process.stderr.write(`${JSON.stringify({ error: { code: safeError.code, message: safeError.message } })}\n`);
  process.exitCode = safeError.code === 'USAGE' ? 2 : 1;
});
