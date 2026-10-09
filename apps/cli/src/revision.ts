import { DefinitionError } from '../../../packages/contracts/src/index.js';
import {
  planStartupRevision, applyStartupRevision, recoverStartupRevision, StartupError,
  type StartupBrief,
} from '../../../packages/startup/src/index.js';
import { readBrief } from './startup.js';

export { renderStartupRevisionReview } from '../../../packages/startup/src/index.js';

function usage(): never {
  throw new DefinitionError('USAGE', 'Use bowerloom revise plan|apply --target <directory> with --brief <file> or --name <name> --goal <goal>. Apply requires --from <installed-revision> and --approve <plan-revision>. Use revise recover --target <directory> --approve <plan-revision> --action resume|rollback.');
}

export async function runRevisionCommand(args: string[]): Promise<unknown> {
  try {
    const [group, command, ...flags] = args;
    if (group !== 'revise' || !['plan', 'apply', 'recover'].includes(command ?? '')) usage();
    const allowed = command === 'recover'
      ? ['--target', '--approve', '--action']
      : ['--target', '--brief', '--name', '--goal', '--assistant', '--team', '--review', '--profile', '--from', '--approve'];
    const values = new Map<string, string>();
    let json = false;
    for (let i = 0; i < flags.length; i += 2) {
      const key = flags[i];
      if (key === '--json') {
        if (command !== 'plan' || json) usage();
        json = true; i -= 1; continue;
      }
      const value = flags[i + 1];
      if (!key || !allowed.includes(key) || !value || value.startsWith('--') || values.has(key)) usage();
      values.set(key, value);
    }
    const targetDir = values.get('--target');
    if (!targetDir) usage();
    if (command === 'recover') {
      const approval = values.get('--approve'), action = values.get('--action');
      if (!approval || (action !== 'resume' && action !== 'rollback')) usage();
      return await recoverStartupRevision(targetDir, approval, action);
    }
    if (command === 'plan' && (values.has('--approve') || values.has('--from'))) usage();
    if (command === 'apply' && (!values.has('--approve') || !values.has('--from'))) usage();
    const inline = ['--name', '--goal', '--assistant', '--team', '--review', '--profile'];
    if (values.has('--brief') && inline.some(key => values.has(key))) usage();
    if (!values.has('--brief') && (!values.has('--name') || !values.has('--goal'))) usage();
    const review = values.get('--review');
    if (review !== undefined && review !== 'milestones' && review !== 'handoff') usage();
    const brief: StartupBrief = values.has('--brief') ? await readBrief(values.get('--brief')!) : {
      projectName: values.get('--name')!, goal: values.get('--goal')!,
      ...(values.has('--assistant') ? { assistantName: values.get('--assistant')! } : {}),
      ...(values.has('--team') ? { teamName: values.get('--team')! } : {}),
      ...(values.has('--profile') ? { profile: values.get('--profile')! as NonNullable<StartupBrief['profile']> } : {}),
      ...(review ? { reviewMode: review as 'milestones' | 'handoff' } : {}),
    };
    const input = { targetDir, brief };
    return command === 'plan' ? await planStartupRevision(input)
      : await applyStartupRevision(input, values.get('--from')!, values.get('--approve')!);
  } catch (error) {
    if (error instanceof DefinitionError) throw error;
    if (error instanceof StartupError) {
      throw new DefinitionError(error.code, 'Revision stopped. Inspect the installation and any pending transaction before creating another plan.');
    }
    throw new DefinitionError('REVISION_IO', 'Revision failed to read or write the selected files. Inspect the paths and pending transaction before another attempt.');
  }
}
