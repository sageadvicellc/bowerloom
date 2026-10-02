import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, realpath, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { spec } from './recipes-fixtures.js';

// Defaults to the assembled CLI. A trusted test-only override supports checking a task
// checkout against the independently compiled integration entry point without editing it.
const main = resolve(process.env.TRELLIS_RECIPE_TEST_MAIN ?? 'dist/apps/cli/src/main.js');
async function fixture(body: (run: (operation: string, input: string, link?: boolean) => Promise<{code:number|null;stdout:string;stderr:string}>) => Promise<void>) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'trellis-recipe-cli-')));
  try {
    const installation = join(root, 'installation.json'), passwordFile = join(root, 'password.json'), guard = join(root, 'no-network.mjs');
    await writeFile(passwordFile, JSON.stringify({password:'synthetic-unused-password'}), {mode:0o600});
    await writeFile(installation, JSON.stringify({format:'trellis/recipe-installation/v1',recipe:spec,
      postgres:{host:'127.0.0.1',port:65431,database:'trellis_synthetic',user:'postgres',passwordFile,controlSchema:'trellis_cli_test',checkpointSchema:'trellis_cli_checkpoints'},
      github:{tokenFile:join(root,'never-read.json')},approval:{subject:'synthetic-operator',enabled:false},
    }), {mode:0o600});
    await writeFile(guard, `import net from 'node:net';
const deny=()=>{process.stderr.write('FORBIDDEN_NETWORK_CALL\\n');throw Error('forbidden synthetic network call')};
net.Socket.prototype.connect=deny;globalThis.fetch=deny;
`);
    let count=0;
    await body(async(operation,input,link=false)=>{
      const file=join(root,`request-${++count}.json`);await writeFile(file,input,{mode:0o600});
      const request=link?join(root,`link-${count}.json`):file;if(link)await symlink(file,request);
      const result=spawnSync(process.execPath,['--import',guard,main,'recipe',operation,'--installation',installation,'--input',request],
        {encoding:'utf8',timeout:10000,maxBuffer:65536});
      assert.equal(result.error,undefined);assert.equal(result.signal,null);assert.ok(!result.stderr.includes('FORBIDDEN_NETWORK_CALL'));
      return {code:result.status,stdout:result.stdout,stderr:result.stderr};
    });
  } finally { await rm(root,{recursive:true,force:true}); }
}
function error(result:{code:number|null;stdout:string;stderr:string},code:string){
  assert.equal(result.code,1);assert.equal(result.stdout,'');assert.equal(JSON.parse(result.stderr).error.code,code);
}
test('compiled recipe CLI accepts inspect --input and reaches approval authorization without connections',async()=>fixture(async run=>{
  const result=await run('inspect','{}');assert.equal(result.code,0);assert.equal(result.stderr,'');assert.deepEqual(JSON.parse(result.stdout).recipe,spec);
  error(await run('approve',JSON.stringify({jobId:`sha256:${'a'.repeat(64)}`,planDigest:`sha256:${'b'.repeat(64)}`})),'APPROVAL_NOT_AUTHORIZED');
}));
test('compiled recipe CLI normalizes nested records before operation-specific validation',async()=>fixture(async run=>{
  error(await run('approve','{"jobId":{"nested":[{"value":1}]},"planDigest":"wrong"}'),'INVALID_JOB_ID');
  error(await run('inspect','{"extra":[{"nested":{"value":1}}]}'),'RECIPE_ARGUMENTS');
  error(await run('plan','{"experiment":{"evidence":[{"content":"synthetic"}]},"draft":{"claims":[{"text":"synthetic"}]}}'),'RECIPE_ARGUMENTS');
}));
test('compiled recipe CLI retains duplicate-key checks at top level and in nested records',async()=>fixture(async run=>{
  error(await run('inspect','{"a":1,"a":2}'),'DUPLICATE_JSON_KEY');
  error(await run('inspect','{"extra":[{"x":1,"\\u0078":2}]}'),'DUPLICATE_JSON_KEY');
}));
test('compiled recipe CLI retains forbidden prototype keys after normalization',async()=>fixture(async run=>{
  for(const input of ['{"__proto__":{"polluted":true}}','{"extra":{"constructor":{}}}','{"extra":[{"prototype":{}}]}'])
    error(await run('inspect',input),'RECIPE_UNAVAILABLE');
}));
test('compiled recipe CLI retains malformed Unicode, byte bounds and no-symlink input rules',async()=>fixture(async run=>{
  error(await run('inspect','{"extra":"\\ud800"}'),'INVALID_JSON');
  error(await run('inspect',' '.repeat(1024*1024+1)),'REQUEST_FILE');
  error(await run('inspect','{}',true),'REQUEST_PATH');
}));
