import pg from 'pg';
import { GraphDriver, PostgresGraphStore } from '../../../dist/packages/graph/src/index.js';
process.once('message',async({config,schema,id})=>{
  const pool=new pg.Pool({...config,max:1});pool.on('error',()=>{});let submissions=0,inspections=0;
  try {
    const driver=new GraphDriver(new PostgresGraphStore(pool,schema),{
      async submit(){submissions++;},async inspect(){inspections++;return null;},
    });
    const result=await driver.advance(id);process.send({status:result.status,holdReason:result.state.holdReason,submissions,inspections});
  } catch(error){process.send({error:error.code??error.name,submissions,inspections});}
  finally{await pool.end();process.disconnect();}
});
