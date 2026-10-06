#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { readInstalledRelease } from './release.js';
import { canonicalJson, DefinitionError } from '../../../packages/contracts/src/index.js';
import { localInstallation, privateJson, openLocalSession } from './controller.js';
import { executeSession, parseSessionCommand } from './session.js';
import type { TestExecutor } from '../../../packages/controlled-tests/src/index.js';
import { compileCrew } from '../../../packages/crew/src/index.js';
import { compileAuthoring } from '../../../packages/authoring/src/index.js';

const HELP = `Usage:
  bowerloom routine plan --root <absolute-.bowerloom-directory> --experiment-id <logical-id> --experiment-digest <sha256:hex>
  bowerloom mcp plan --declaration <absolute-json-file> --binding <absolute-json-file> --catalog <absolute-json-file> --synthetic
  bowerloom init plan --mode new|existing --target <absolute-directory> --name <project-name> --goal <goal> [--profile engineer|founder|research] [--assistant <name>] [--team <name>] [--review milestones|handoff] [--json]
  bowerloom init apply --mode new|existing --target <absolute-directory> --name <project-name> --goal <goal> [--profile engineer|founder|research] [--assistant <name>] [--team <name>] [--review milestones|handoff] --approve <revision>
  bowerloom init plan --mode new|existing --target <absolute-directory> --brief <brief.json> [--json]
  bowerloom init apply --mode new|existing --target <absolute-directory> --brief <brief.json> --approve <revision>
  bowerloom init status --target <absolute-directory>
  bowerloom init demo-plan --target <absolute-directory> --from <installed-revision> [--json]
  bowerloom revise plan --target <absolute-directory> --brief <brief.json>
  bowerloom revise apply --target <absolute-directory> --brief <brief.json> --from <installed-revision> --approve <plan-revision>
  bowerloom revise recover --target <absolute-directory> --approve <plan-revision> --action resume|rollback
  bowerloom harness import --harness codex|claude --file <absolute-fixture-file> --synthetic
  bowerloom harness plan --harness codex|claude --file <absolute-fixture-file> --neutral <private-json-file> --synthetic
  bowerloom harness managed-plan --harness codex|claude --file <absolute-fixture-file> --neutral <private-json-file> --state <new-private-directory> --synthetic
  bowerloom harness apply --harness codex|claude --file <absolute-fixture-file> --neutral <private-json-file> --state <new-private-directory> --synthetic --approve <revision>
  bowerloom harness removal-plan --state <private-directory> --synthetic
  bowerloom harness remove --state <private-directory> --synthetic --approve <removal-plan-revision>
  bowerloom harness recover --state <private-directory> --synthetic --approve <recorded-operation-revision>
  bowerloom link plan --from <root> --to <root> --file <definition> --out <private-new-file>
  bowerloom link apply --from <root> --to <root> --file <definition> --out <private-new-file> --approve <revision>
  bowerloom link read --connection <file> --target <receiving-root>
  bowerloom link revoke --connection <file>
  bowerloom control plan|register --root <root> --team <id> --spec <relative-team-file> [--adapter graph|recipe --installation <private.json>] [--registry <directory>] [--approve <revision>]
  bowerloom destruct <team-id> --root <root> [--registry <directory>] [--timeout-ms <milliseconds>]
  bowerloom destruct all [--registry <directory>] [--timeout-ms <milliseconds>]
  bowerloom backend doctor
  bowerloom backend plan|install --root <new-absolute-directory> [--studio-port <port>] [--database-port <port>] [--approve <revision>]
  bowerloom backend status --root <private-installation-directory>
  bowerloom portable validate <bundle-directory>
  bowerloom portable plan|install <bundle-directory> --select <part,part> --harness codex|claude --target <new-absolute-directory> [--approve <revision>]
  bowerloom recipe inspect|setup --installation <private.json>
  bowerloom recipe plan|review|approve|run|reconcile|cancel|status --installation <private.json> --input <request.json>
  bowerloom validate <crew.yaml> [--root <directory>]
  bowerloom plan <crew.yaml> [--root <directory>]
  bowerloom authoring validate|export <authoring.json> --scenario <frozen-scenario.json> [--root <directory>]
  bowerloom up --demo --pro|--5x|--20x --installation <private.json>
  bowerloom status|review|cancel --installation <private.json>
  bowerloom approve --installation <private.json> --candidate <sha256:...> --action <sha256:...>

Routine plan reads a standalone portable authoring tree and prints local review JSON.
It does not install/import files, validate an installation receipt, or grant execution authority.
MCP plan reads three selected test files and prints a private review plan.
The recorded catalog is untrusted input. This command does not discover tools, connect a server, resolve secrets, or grant authority.
Keep its output private. It includes installed paths and connection details.
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
Existing mode adds only .bowerloom. Harness commands process selected test fixtures. Live Codex and Claude Code configuration support and two-harness execution remain unproven.
Backend install requires --approve with the exact current plan revision.
Backend setup uses a separate local Supabase profile. It provisions no agent runtime.
Docker Desktop is a prerequisite. The CLI never installs privileged host software.
Portable install requires --approve with the exact current plan revision.
Portable installation copies selected files. It starts no workers.
The source root defaults to the directory that contains crew.yaml.
Validate and plan read source files and print JSON. They start no workers.
Status and review read the prepared session without a model or browser.
Up stops for exact approval. Approve writes and tests the stored proposal.
Tier flags do not promise measured throughput. The task runner executes tasks sequentially.
The plan records declarations. It grants no runtime permission.
Recipe commands share their controller with MCP. The operator CLI owns exact approval.
`;

const INIT_HELP = [
  'Bowerloom setup: review a personal-agent profile and first team specification', '', 'Usage:',
  ...HELP.split('\n').filter(line => line.startsWith('  bowerloom init ')), '',
  'Plan prints a plain-English review. Add --json for exact file contents and hashes.',
  'New mode requires an absent target; existing mode adds only .bowerloom to an existing project.',
  'Apply requires unchanged inputs and the exact plan revision. It starts no workers or backend services.',
  'Status inspects the saved specification. Demo-plan offers an optional handoff without execution.', '',
].join('\n');

function installedVersion(): string { return readInstalledRelease().version; }

function releaseHeading(): string {
  const record = readInstalledRelease();
  return `Bowerloom ${record.version}: open beta (${record.state})\n${record.execution}\n`;
}

async function main(args: string[]): Promise<void> {
  if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) { process.stdout.write(`${releaseHeading()}\n${HELP}`); return; }
  if (args.length === 1 && (args[0] === '--version' || args[0] === '-V')) { process.stdout.write(`Bowerloom ${installedVersion()}\n`); return; }
  if (args.length === 2 && args[0] === 'init' && (args[1] === '--help' || args[1] === '-h')) { process.stdout.write(`${releaseHeading()}\n${INIT_HELP}`); return; }
  if (args[0] === 'routine') {
    const { runRoutineCommand } = await import('./routine.js');
    process.stdout.write(`${canonicalJson(await runRoutineCommand(args))}\n`);
    return;
  }
  if (args[0] === 'mcp') {
    const { runMcpPlanCommand } = await import('./mcp-plan.js');
    process.stdout.write(`${canonicalJson(await runMcpPlanCommand(args))}\n`);
    return;
  }
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
    throw new DefinitionError('USAGE', 'Use bowerloom validate <crew.yaml> or bowerloom plan <crew.yaml>, with optional --root <directory>.');
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
  const safeError = error instanceof DefinitionError ? error : new DefinitionError(code, 'The command failed. Review the relevant local files and operation records before another action. This error supplies no registered-work stop result.');
  process.stderr.write(`${JSON.stringify({ error: { code: safeError.code, message: safeError.message } })}\n`);
  process.exitCode = safeError.code === 'USAGE' ? 2 : 1;
});
