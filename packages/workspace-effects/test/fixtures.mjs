import { canonicalJson, digest } from '../../../dist/packages/contracts/src/index.js';
export function request(requestId, path = 'output/result.txt', content = 'synthetic result', expectedDigest = null, workspaceId = 'synthetic-workspace') {
  const proposal = { format: 'trellis/action/v0.7-alpha', scope: { workspaceId, runId: 'synthetic-run', taskId: 'build' }, requestId,
    candidateRevision: digest('synthetic-candidate'), ownerEpoch: 1,
    edit: { operation: 'workspace.write', path, expectedDigest, content } };
  const actionDigest = digest(canonicalJson(proposal));
  return { proposal, actionDigest, operationKey: digest(canonicalJson({ scope: proposal.scope, requestId, actionDigest })), deadlineMs: 2000 };
}
export const signal = () => new AbortController().signal;
