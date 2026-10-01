import pg from 'pg';
import { RegisteredTestAcceptance,PostgresTestStore,testOperationId } from '../../../dist/packages/controlled-tests/src/index.js';
import { identity,Executor } from './fixtures.mjs';
process.once('message',async({config,schema,brokerSchema,input,receipt,manifest})=>{
  const pool=new pg.Pool({...config,max:2});pool.on('error',()=>{});const executor=new Executor(),reader=new RegisteredTestAcceptance({store:new PostgresTestStore(pool,{schema,brokerSchema}),manifest,executor,identity});
  try{
    let error;try{await reader.read(input,receipt,{signal:new AbortController().signal,launcherId:'fresh-process',ownerCredential:'owner',async guard(){}});}catch(e){error=e.code;}
    const scope={workspaceId:input.task.workspaceId,runId:input.task.runId,taskId:input.task.taskId};
    const stored=await reader.inspect(scope,testOperationId(scope,receipt),'owner');process.send({status:stored.status,error,executions:executor.calls.length});
  }catch{process.exitCode=1;}finally{await reader.close();await pool.end();process.disconnect();}
});
