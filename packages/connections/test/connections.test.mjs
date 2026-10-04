import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, chmod, mkdir, readFile, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { realpathSync } from 'node:fs';
import { planStartup, applyStartup, inspectStartup } from '../../../dist/packages/startup/src/index.js';
import { planLink, applyLink, readLink, revokeLink } from '../../../dist/packages/connections/src/index.js';

async function fixture(goal = 'Review a fictional project setup with no worker execution.') {
  const dir = await mkdtemp(join(realpathSync(tmpdir()), 'bowerloom-links-')); await chmod(dir, 0o700);
  const from = join(dir, 'personal'), to = join(dir, 'project');
  for (const targetDir of [from, to]) {
    const input = {mode:'new', targetDir, brief:{projectName:'Connection fixture',goal}};
    const plan = await planStartup(input); await applyStartup(input, plan.revision);
  }
  return { dir, from, to, file:'working-agreement.md', output:join(dir, 'approved-link.json') };
}
const input = ({ from,to,file,output }) => ({from,to,file,output});

test('approved connection shares one pinned definition without modifying either setup', async () => {
  const f=await fixture(), plan=await planLink(input(f));
  assert.equal(plan.permissions.execute,false); assert.equal(plan.permissions.followLinks,false);
  const before=await readFile(join(f.from,'.bowerloom/installation-receipt.json'));
  await applyLink(input(f),plan.revision);
  const read=await readLink(f.output,f.to);
  assert.equal(read.text,plan.disclosure.text); assert.equal(read.executionAuthorized,false);
  assert.deepEqual(await readFile(join(f.from,'.bowerloom/installation-receipt.json')),before);
  assert.equal((await inspectStartup(f.from)).specReady,true); assert.equal((await inspectStartup(f.to)).specReady,true);
});
test('missing approval and changed recipients cannot reuse approval', async () => {
  const f=await fixture(), plan=await planLink(input(f));
  await assert.rejects(applyLink(input(f),''),{code:'LINK_EXACT_APPROVAL_REQUIRED'});
  await assert.rejects(applyLink({...input(f),from:f.to,to:f.from},plan.revision),{code:'LINK_STALE_APPROVAL'});
});
test('read refuses a different receiving root', async () => {
  const f=await fixture(), plan=await planLink(input(f));await applyLink(input(f),plan.revision);
  await assert.rejects(readLink(f.output,f.from),{code:'LINK_WRONG_RECIPIENT'});
});
test('changed source cannot silently update approved disclosure', async () => {
  const f=await fixture(), plan=await planLink(input(f));await applyLink(input(f),plan.revision);
  await writeFile(join(f.from,'.bowerloom',f.file),'Unapproved replacement');
  await assert.rejects(readLink(f.output,f.to),{code:'LINK_CHANGED'});
  const changed={...input(f),output:join(f.dir,'reapproved.json')};
  const next=await planLink(changed);await applyLink(changed,next.revision);
  assert.equal((await readLink(changed.output,f.to)).text,'Unapproved replacement');
});
test('revocation is repeat-safe, preserves receipt and refuses future reads', async () => {
  const f=await fixture(),plan=await planLink(input(f));await applyLink(input(f),plan.revision);const before=await readFile(f.output);
  const first=await revokeLink(f.output);assert.deepEqual(await revokeLink(f.output),first);
  assert.deepEqual(await readFile(f.output),before);await assert.rejects(readLink(f.output,f.to),{code:'LINK_REVOKED'});
});
test('paths outside permitted definitions and project-local receipts are rejected', async () => {
  const f=await fixture();
  for (const file of ['installation-receipt.json','../private.txt','connections/other.json','/etc/passwd']) await assert.rejects(planLink({...input(f),file}),{code:'LINK_EXPORT_NOT_ALLOWED'});
  await assert.rejects(planLink({...input(f),output:join(f.to,'link.json')}),{code:'LINK_OUTPUT_INSIDE_ROOT'});
});
test('root aliases and an existing output cannot be approved', async () => {
  const f=await fixture();await symlink(f.from,join(f.dir,'alias'));
  await assert.rejects(planLink({...input(f),from:join(f.dir,'alias')}),{code:'LINK_SYMLINK'});
  await writeFile(f.output,'valuable content',{mode:0o600});await assert.rejects(planLink(input(f)),{code:'LINK_OUTPUT_EXISTS'});
  assert.equal(await readFile(f.output,'utf8'),'valuable content');
});
test('a substituted root fails instead of receiving access', async () => {
  const f=await fixture(),plan=await planLink(input(f));await applyLink(input(f),plan.revision);
  const raw=JSON.parse(await readFile(f.output,'utf8'));raw.recipient.path=f.from;await writeFile(f.output,JSON.stringify(raw));
  await assert.rejects(readLink(f.output,f.to),{code:'LINK_RECEIPT'});
});
test('nonprivate output directory is refused', async()=>{
  const f=await fixture();const shared=join(f.dir,'shared');await mkdir(shared,{mode:0o755});
  await assert.rejects(planLink({...input(f),output:join(shared,'link.json')}),{code:'LINK_PRIVATE_DIRECTORY'});
});

test('a maximum-size escaped startup review round-trips through a private receipt', async () => {
  const f = await fixture('&'.repeat(6000));
  const selected = {...input(f), file:'startup-review.md'};
  const plan = await planLink(selected);
  assert.ok(plan.disclosure.bytes > 65536);
  await applyLink(selected, plan.revision);
  assert.equal((await readLink(f.output, f.to)).text, plan.disclosure.text);
});
test('edited disclosure rejects terminal controls and invisible direction changes', async () => {
  const f = await fixture();
  for (const content of ['before\u001b[2Jafter', 'before\u0008after', 'before\rafter', 'before\u202eafter']) {
    await writeFile(join(f.from, '.bowerloom', f.file), content);
    await assert.rejects(planLink(input(f)), {code:'LINK_UNSAFE_TEXT'});
  }
});
