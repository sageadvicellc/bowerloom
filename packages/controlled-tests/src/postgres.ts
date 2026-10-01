import { isPromise } from 'node:util/types';
import type { Pool, PoolClient } from 'pg';
import { canonicalJson, digest } from '../../contracts/src/index.js';
import { decodeState, STATE_VERSION } from '../../broker-postgres/src/state.js';
import type { Scope,TaskState } from '../../broker/src/index.js';
import { copy, fail, record, same, scope, sha } from './validation.js';
import { TestError } from './types.js';
import type { TestStore, TestRecord } from './types.js';
const schema=(v:string):string=>typeof v==='string'&&/^trellis_[a-z][a-z0-9_]{0,46}$/.test(v)?`"${v}"`:fail('INVALID_SCHEMA');
export class PostgresTestStore implements TestStore {
  readonly #pool:Pick<Pool,'connect'>;readonly #schema:string;readonly #broker:string;
  constructor(pool:Pick<Pool,'connect'>,options:{schema:string;brokerSchema:string}){this.#pool=pool;this.#schema=schema(options.schema);this.#broker=schema(options.brokerSchema);if(this.#schema===this.#broker)fail('INVALID_SCHEMA');}
  async #transaction<T>(body:(client:PoolClient)=>Promise<T>):Promise<T>{
    let client:PoolClient;try{client=await this.#pool.connect();}catch{fail('TEST_STORE_UNAVAILABLE');}
    let commit=false,discard=false;
    try{await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');await client.query("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='10s'; SET LOCAL idle_in_transaction_session_timeout='10s'; SET LOCAL synchronous_commit='on'");
      const result=await body(client);commit=true;await client.query('COMMIT');return result;
    }catch(error){if(commit){discard=true;throw new TestError('TEST_COMMIT_UNKNOWN');}try{await client.query('ROLLBACK');}catch{discard=true;throw new TestError('TEST_ROLLBACK_FAILED');}
      throw error instanceof TestError?error:new TestError('TEST_DATABASE_ERROR');
    }finally{client.release(discard);}
  }
  async createSchema():Promise<void>{await this.#transaction(async client=>{
    await client.query(`CREATE SCHEMA ${this.#schema}`);
    await client.query(`CREATE TABLE ${this.#schema}.metadata(singleton boolean PRIMARY KEY CHECK(singleton),version integer NOT NULL)`);
    await client.query(`INSERT INTO ${this.#schema}.metadata VALUES(true,1)`);
    await client.query(`CREATE TABLE ${this.#schema}.tests(id text PRIMARY KEY,version integer NOT NULL,state jsonb NOT NULL,checksum text NOT NULL)`);
  });}
  transaction<T>(scopeInput:Scope,testId:string,change:(record:TestRecord|null,authority:TaskState)=>{record:TestRecord|null;result:T}):Promise<T> {
    const expected=scope(scopeInput);if(!sha(testId))fail('INVALID_TEST_ID');
    return this.#transaction(async client=>{
      const metadata=(await client.query(`SELECT singleton,version FROM ${this.#schema}.metadata FOR SHARE`)).rows;
      const brokerMeta=(await client.query(`SELECT singleton,schema_version FROM ${this.#broker}.store_metadata FOR SHARE`)).rows;
      if(metadata.length!==1||metadata[0].singleton!==true||metadata[0].version!==1||brokerMeta.length!==1||brokerMeta[0].singleton!==true||brokerMeta[0].schema_version!==STATE_VERSION)fail('TEST_SCHEMA_VERSION');
      // The broker row is the common authority and absent-test creation lock.
      const taskRows=(await client.query(`SELECT state_version,state,checksum FROM ${this.#broker}.task_states WHERE workspace_id=$1 AND run_id=$2 AND task_id=$3 FOR UPDATE`,[expected.workspaceId,expected.runId,expected.taskId])).rows;
      if(taskRows.length!==1)fail('TEST_AUTHORITY_MISSING');
      const authority=decodeState(taskRows[0],expected);
      const rows=(await client.query(`SELECT version,state,checksum FROM ${this.#schema}.tests WHERE id=$1 FOR UPDATE`,[testId])).rows;
      let current:TestRecord|null=null;
      if(rows.length){const row=rows[0];if(row.version!==1||digest(canonicalJson(row.state))!==row.checksum)fail('CORRUPT_TEST');current=record(row.state);
        if(current.id!==testId||!same(current.request.scope,expected))fail('CORRUPT_TEST');}
      const changed=change(current?copy(current):null,authority);
      if(isPromise(changed)){void Promise.prototype.then.call(changed,undefined,()=>{});fail('INVALID_TEST_MUTATOR');}
      if(!changed||Object.getPrototypeOf(changed)!==Object.prototype)fail('INVALID_TEST_MUTATOR');
      const fields=Object.getOwnPropertyDescriptors(changed);
      if(Reflect.ownKeys(changed).length!==2||Object.keys(fields).sort().join()!=='record,result'||!Object.values(fields).every(v=>v.enumerable&&'value'in v))fail('INVALID_TEST_MUTATOR');
      const next=changed.record===null?null:record(changed.record);
      if(next&&(next.id!==testId||!same(next.request.scope,expected)))fail('CORRUPT_TEST');
      if(current&&(!next||!same(current.request,next.request)||current.approvalDigest!==next.approvalDigest
        ||(['PASSED','FAILED','CANCELLED'].includes(current.status)&&!same(current,next))
        ||(current.status!=='CLAIMED'&&next.status!=='HOLD'&&next.status!=='CANCELLED'&&!same(current,next))))fail('TEST_HISTORY_CONFLICT');
      const result=changed.result===undefined?undefined:copy(changed.result);
      if(next){const json=canonicalJson(next);await client.query(`INSERT INTO ${this.#schema}.tests VALUES($1,1,$2::jsonb,$3) ON CONFLICT(id) DO UPDATE SET state=EXCLUDED.state,checksum=EXCLUDED.checksum`,[testId,json,digest(json)]);}
      return result as T;
    });
  }
}
