import { canonicalJson, digest, DefinitionError } from '../../../packages/contracts/src/index.js';
import type { GraphView } from '../../../packages/graph/src/index.js';
import type { RunState } from '../../../packages/runtime/src/index.js';

export interface SessionPort {
  status(): Promise<GraphView>;
  advance(): Promise<GraphView>;
  run(taskId: string): Promise<RunState | null>;
  approve(taskId: string, candidateRevision: string, actionDigest: string): Promise<void>;
  cancel(): Promise<void>;
  close(): Promise<void>;
}
export type SessionCommand =
  | { command: 'up'; installation: string; tier: 'pro' | '5x' | '20x' }
  | { command: 'status' | 'review' | 'cancel'; installation: string }
  | { command: 'approve'; installation: string; candidate: string; action: string };
const usage = (): never => { throw new DefinitionError('USAGE', 'Use an explicit installation file and the documented command arguments.'); };
export function parseSessionCommand(args: string[]): SessionCommand {
  const command = args[0];
  if (!['up','status','review','approve','cancel'].includes(command ?? '')) return usage();
  const flags = new Map<string,string>();
  for (let i=1;i<args.length;i++) {
    const flag=args[i]!;
    if (flags.has(flag)) return usage();
    if (['--demo','--pro','--5x','--20x'].includes(flag)) { flags.set(flag,'true'); continue; }
    if (!['--installation','--candidate','--action'].includes(flag)) return usage();
    const value=args[++i]; if (!value || value.startsWith('--') || value.includes('\0')) return usage();
    flags.set(flag,value);
  }
  const installation=flags.get('--installation'); if (!installation) return usage();
  if (command==='up') {
    const tiers=['pro','5x','20x'] as const; const selected=tiers.filter(t=>flags.has(`--${t}`));
    if (flags.size!==3 || !flags.has('--demo') || selected.length!==1) return usage();
    return {command,installation,tier:selected[0]!};
  }
  if (command==='approve') {
    const candidate=flags.get('--candidate'),action=flags.get('--action');
    if (flags.size!==3 || !candidate || !action || ![candidate,action].every(v=>/^sha256:[a-f0-9]{64}$/.test(v))) return usage();
    return {command,installation,candidate,action};
  }
  if (flags.size!==1) return usage();
  return {command:command as 'status'|'review'|'cancel',installation};
}
export async function sessionSummary(port: SessionPort, view: GraphView, includeProposal=false): Promise<object> {
  const tasks=[];
  for (const id of view.state.input.plan.taskOrder) {
    const state=await port.run(id);
    tasks.push({id,status:state?.status ?? 'NOT_STARTED',reason:state?.reason ?? null,
      ...(includeProposal ? {proposal:state?.proposal ?? null} : {}),
      actionDigest:state?.proposal ? digest(canonicalJson(state.proposal)) : null,
      receipt:state?.receipt ?? null,acceptance:state?.acceptance ?? null});
  }
  return {format:'trellis/session-status/v0.7-alpha',graphId:view.state.id,candidateRevision:view.state.input.plan.candidateRevision,
    status:view.status,tasks,capacityTierCalibration:'unmeasured',maxActiveWorkers:view.state.input.plan.definition.budget.maxActiveWorkers};
}
export async function executeSession(command: SessionCommand, port: SessionPort,
  emit: (value:object)=>void, signal:AbortSignal,
  sleep:(ms:number)=>Promise<void> = ms=>new Promise(resolve=>setTimeout(resolve,ms)), now:()=>number=Date.now): Promise<void> {
  let summary:object|undefined;
  try {
    let view=await port.status(); let approvedTask:string|null=null;let cancelled=false;
    const cancelIfRequested=async()=>{if(!signal.aborted)return false;if(!cancelled){await port.cancel();cancelled=true;}view=await port.status();return true;};
    await cancelIfRequested();
    if (!cancelled&&command.command==='cancel') { await port.cancel(); view=await port.status(); }
    if (!cancelled&&command.command==='approve') {
      if (view.state.input.plan.candidateRevision!==command.candidate) throw new DefinitionError('STALE_APPROVAL','The supplied candidate does not match this session.');
      const waiting=[];
      for(const id of view.state.input.plan.taskOrder) {
        const state=await port.run(id);
        if(state?.status==='WAITING_APPROVAL'&&state.proposal) waiting.push({id,state});
      }
      if(waiting.length!==1) throw new DefinitionError('APPROVAL_UNAVAILABLE','The session must contain one task waiting for approval.');
      const {id,state}=waiting[0]!;
      if(digest(canonicalJson(state.proposal))!==command.action) throw new DefinitionError('STALE_APPROVAL','The supplied action does not match the stored proposal.');
      if(!await cancelIfRequested()){await port.approve(id,command.candidate,command.action);approvedTask=id;}
      await cancelIfRequested();
    }
    if(!cancelled&&(command.command==='up'||command.command==='approve')) {
      const deadline=now()+120000;
      for (;;) {
        if(await cancelIfRequested()) break;
        view=await port.advance();
        if(['HOLD','CANCELLED','ACCEPTANCE_FAILED','COMPLETED'].includes(view.status)) break;
        if(view.status==='WAITING_APPROVAL'&&(!approvedTask||(await port.run(approvedTask))?.status!=='WAITING_APPROVAL')) break;
        if(now()>=deadline) { await port.cancel(); view=await port.status(); break; }
        await sleep(200);
      }
    }
    summary=await sessionSummary(port,view,command.command==='review');
  } finally { await port.close(); }
  emit(summary!);
}

