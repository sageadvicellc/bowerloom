import { isAbsolute } from 'node:path';
import pg from 'pg';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import { RecipeService, PostgresRecipeStore, GitHubConnection, RecipeError } from '../../../packages/recipes/src/index.js';
import type { RecipeSpec } from '../../../packages/recipes/src/index.js';
import { clone, digest, exact, fail, id, specCopy } from '../../../packages/recipes/src/validation.js';
import { schemaName } from '../../../packages/recipes/src/postgres.js';
import { privateJson } from './controller.js';
import { strictJson } from '../../../packages/codex-adapter/src/safe.js';
export const recipeOperations = ['inspect','setup','plan','review','approve','run','reconcile','cancel','status'] as const;
export type RecipeOperation = typeof recipeOperations[number];
export interface RecipeInstallation {
  format:'trellis/recipe-installation/v1'; recipe:RecipeSpec;
  postgres:{host:'127.0.0.1';port:number;database:string;user:string;passwordFile:string;controlSchema:string;checkpointSchema:string};
  github:{tokenFile:string}; approval:{subject:string;enabled:boolean};
}
export function recipeInstallation(value: unknown): RecipeInstallation {
  const v = clone(value) as RecipeInstallation;
  if (!exact(v,['format','recipe','postgres','github','approval']) || v.format !== 'trellis/recipe-installation/v1') fail('INSTALLATION_FORMAT');
  v.recipe = specCopy(v.recipe); const db = v.postgres;
  if (!exact(db,['host','port','database','user','passwordFile','controlSchema','checkpointSchema']) || db.host !== '127.0.0.1'
    || !Number.isInteger(db.port) || db.port < 1024 || db.port > 65535 || !/^trellis_[a-z0-9_]{1,55}$/.test(db.database)
    || !/^[a-z][a-z0-9_]{0,62}$/.test(db.user) || typeof db.passwordFile !== 'string' || !isAbsolute(db.passwordFile)) fail('INSTALLATION_DATABASE');
  schemaName(db.controlSchema); schemaName(db.checkpointSchema); if (db.controlSchema === db.checkpointSchema) fail('INSTALLATION_SCHEMA');
  if (!exact(v.github,['tokenFile']) || typeof v.github.tokenFile !== 'string' || !isAbsolute(v.github.tokenFile)) fail('INSTALLATION_GITHUB');
  if (!exact(v.approval,['subject','enabled']) || !id(v.approval.subject) || typeof v.approval.enabled !== 'boolean') fail('INSTALLATION_APPROVAL');
  return v;
}
/** Private startup path is an operator capability. Never expose it as a per-tool argument. */
export async function openRecipeService(installationPath: string): Promise<{dispatch(operation: string,args: unknown):Promise<object>;close():Promise<void>}> {
  const config = recipeInstallation(await privateJson(installationPath)), db = config.postgres;
  const secret = await privateJson(db.passwordFile,16384) as {password:string};
  if (!exact(secret,['password']) || typeof secret.password !== 'string' || !secret.password || secret.password.length > 8192) fail('DATABASE_CREDENTIAL');
  const pool = new pg.Pool({host:db.host,port:db.port,database:db.database,user:db.user,password:secret.password,ssl:false,max:4,
    connectionTimeoutMillis:3000,idleTimeoutMillis:1000,application_name:'trellis_labs_recipe'});
  pool.on('error',()=>{});
  const store = new PostgresRecipeStore(pool,db.controlSchema), saver = new PostgresSaver(pool,undefined,{schema:db.checkpointSchema});
  const issuer = Symbol('private-operator-issuer');
  const github = new GitHubConnection(config.recipe,async() => {
    const token = await privateJson(config.github.tokenFile,32768) as {token:string};
    if (!exact(token,['token']) || typeof token.token !== 'string') fail('GITHUB_CREDENTIAL'); return token.token;
  });
  const service = new RecipeService({store,github,allowedRecipe:config.recipe,authorizeApproval:async credential => {
    if (!config.approval.enabled || credential !== issuer) fail('APPROVAL_NOT_AUTHORIZED'); return {subject:config.approval.subject};
  }},saver);
  let closed = false;
  const setup = async():Promise<object> => store.exclusive(digest(`setup:${db.controlSchema}:${db.checkpointSchema}`),async guard => {
    const rows = (await pool.query('SELECT nspname FROM pg_namespace WHERE nspname = ANY($1::text[])',[[db.controlSchema,db.checkpointSchema]])).rows;
    const names = rows.map((r:{nspname:string})=>r.nspname);
    if (!names.includes(db.controlSchema)) {
      if (names.length) fail('CHECKPOINT_SCHEMA_ALREADY_EXISTS'); await guard(); await store.createSchema();
    }
    // Validating control metadata precedes saver migrations. A failed migration is safe to resume using its own migration records.
    const recipe = await service.setup(); await guard(); await saver.setup(); return {recipe,backend:'postgres',engine:'langgraph'};
  });
  return {
    async dispatch(operation,args) {
      try {
      if (closed) fail('SERVICE_CLOSED'); const input = clone(args) as Record<string,unknown>;
      if (!recipeOperations.includes(operation as RecipeOperation)) fail('RECIPE_OPERATION');
      const keys = operation === 'plan' ? ['experiment','draft','metrics'] : operation === 'approve' ? ['jobId','planDigest']
        : ['inspect','setup'].includes(operation) ? [] : ['jobId'];
      if (!exact(input,keys)) fail('RECIPE_ARGUMENTS');
      if (operation === 'inspect') return service.inspect();
      if (operation === 'setup') return await setup();
      if (operation === 'plan') return await service.plan({experiment:input.experiment,draft:input.draft,metrics:input.metrics});
      if (typeof input.jobId !== 'string') fail('INVALID_JOB_ID');
      if (operation === 'approve') {
        if (typeof input.planDigest !== 'string') fail('INVALID_APPROVAL');
        return await service.approve({jobId:input.jobId,planDigest:input.planDigest},issuer);
      }
      return await service[operation as 'review'|'status'|'run'|'reconcile'|'cancel'](input.jobId);
      } catch (error) { throw error instanceof RecipeError ? error : new RecipeError('RECIPE_UNAVAILABLE'); }
    },
    async close() { if (!closed) { closed = true; await pool.end(); } },
  };
}
export const recipeHelp = 'recipe <inspect|setup|plan|review|approve|run|reconcile|cancel|status> --installation <private-json> [--input <request-json>]';
/** Root prints the returned structured result. No provider output or credentials enter an error message. */
export async function runRecipeCommand(args: string[]): Promise<object> {
  if (args[0] !== 'recipe' || !recipeOperations.includes(args[1] as RecipeOperation)) throw new RecipeError('RECIPE_USAGE');
  const flags = new Map<string,string>();
  for (let i=2;i<args.length;i+=2) { const key=args[i]!,value=args[i+1]; if (!['--installation','--input'].includes(key) || flags.has(key) || !value) fail('RECIPE_USAGE'); flags.set(key,value); }
  const installation = flags.get('--installation'); if (!installation) fail('RECIPE_USAGE');
  // Agent input is data only. Bounded file loading prevents pipes/devices and oversized packets.
  let input: unknown = {};
  if (flags.has('--input')) {
    const {open,realpath} = await import('node:fs/promises'), {constants} = await import('node:fs'), {resolve} = await import('node:path');
    const p = resolve(flags.get('--input')!); if (await realpath(p) !== p) fail('REQUEST_PATH');
    const file = await open(p,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
    try { const before = await file.stat(); if (!before.isFile() || before.nlink!==1 || before.size>1024*1024) fail('REQUEST_FILE');
      const bytes = Buffer.alloc(1024*1024+1); let size=0;
      while(size<bytes.length) { const next = await file.read(bytes,size,bytes.length-size,null); if(!next.bytesRead)break; size+=next.bytesRead; }
      const after=await file.stat(); if(size!==before.size || after.size!==before.size || after.mtimeMs!==before.mtimeMs || after.ctimeMs!==before.ctimeMs)fail('REQUEST_CHANGED');
      input = strictJson(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,size)),1024*1024);
    } finally { await file.close(); }
  }
  const controller = await openRecipeService(installation);
  try { return await controller.dispatch(args[1]!,input); } finally { await controller.close(); }
}
