import { resolve } from 'node:path';
import { compileCrew } from '../../../dist/packages/crew/src/index.js';
import { createTaskState } from '../../../dist/packages/broker/src/index.js';

export const plan = await compileCrew(resolve('examples/endor/crew.yaml'));
export function state(runId = 'synthetic-run') {
  return createTaskState(plan, { workspaceId: 'synthetic-workspace', runId, taskId: 'build',
    ownerSubject: 'agent:coda', ownerEpoch: 1, approverSubjects: ['founder:reviewer'],
    readyAtMs: 1000, leaseExpiresAtMs: 1_000_000, completedDependencies: ['design'] });
}
