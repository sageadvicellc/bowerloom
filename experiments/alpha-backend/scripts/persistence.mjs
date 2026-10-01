import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import pg from 'pg';
const root=new URL('../',import.meta.url);
const secrets=JSON.parse(readFileSync(new URL('.private/credentials.json',root),'utf8'));
const connectionString=`postgresql://postgres:${secrets.POSTGRES_PASSWORD}@127.0.0.1:56582/postgres`;
async function snapshot(){
 const client=new pg.Client({connectionString});await client.connect();
 try{
 return {effects:(await client.query('SELECT workflow_id,stage FROM proof.effects ORDER BY workflow_id,stage')).rows,workflows:(await client.query('SELECT workflow_uuid,status FROM dbos.workflow_status ORDER BY workflow_uuid')).rows};
 }finally{await client.end();}
}
const before=await snapshot();
assert.ok(before.effects.length>=4,'Run the recovery proof before the persistence test.');
const start=performance.now();
const stopped=spawnSync('python3',[fileURLToPath(new URL('scripts/stack.py',root)),'restart-database'],{encoding:'utf8',timeout:35000});
assert.equal(stopped.status,0,'The isolated proof database must restart.');
let after;
const deadline=Date.now()+30000;
while(Date.now()<deadline){try{after=await snapshot();break;}catch{await new Promise(r=>setTimeout(r,200));}}
assert.deepEqual(after,before,'Persisted effects and workflow records must survive database restart.');
const report={observedAt:new Date().toISOString(),passed:true,restartMilliseconds:performance.now()-start,effects:after.effects.length,workflows:after.workflows.length,scope:'only trellis-alpha-proof-db-1'};
writeFileSync(new URL('persistence-result.json',root),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
