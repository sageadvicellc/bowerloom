import pg from 'pg';
import {PostgresSaver} from '@langchain/langgraph-checkpoint-postgres';
import {PostgresRecipeStore,RecipeService} from '../../../dist/packages/recipes/src/index.js';
import {FakeGitHub,spec} from '../../../dist/tests/recipes-fixtures.js';
process.once('message',async({config,schema,cpSchema,jobId})=>{
  const pool=new pg.Pool(config);pool.on('error',()=>{});
  try{const github=new FakeGitHub();const service=new RecipeService({store:new PostgresRecipeStore(pool,schema),github,allowedRecipe:spec,authorizeApproval:async()=>{throw Error('no approval in restart reader');}},new PostgresSaver(pool,undefined,{schema:cpSchema}));
    const result=await service.run(jobId);process.send({status:result.status,mutations:github.calls.length});
  }catch{process.exitCode=1;}finally{await pool.end();process.disconnect();}
});
