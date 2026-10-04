// Synthetic discovery fixture only. Uses built-ins and never executes received methods.
import { createInterface } from 'node:readline';
import { appendFileSync } from 'node:fs';
const mode=process.argv[2]??'normal';
const record=value=>{if(process.env.SYNTHETIC_LOG)appendFileSync(process.env.SYNTHETIC_LOG,JSON.stringify(value)+'\n');};
record({started:true,pid:process.pid,cwd:process.cwd(),argv:process.argv.slice(2),environment:Object.keys(process.env).sort(),secretPresent:process.env.SYNTHETIC_SECRET==='PRIVATE_SYNTHETIC_VALUE'});
const send=value=>process.stdout.write(JSON.stringify(value)+'\n');
if(mode==='startup-message')send({jsonrpc:'2.0',method:'notifications/tools/list_changed'});
if(mode==='ignore-term'){process.on('SIGTERM',()=>{});setInterval(()=>{},1000);}
createInterface({input:process.stdin}).on('line',line=>{
 const request=JSON.parse(line);record({method:request.method});
 if(request.method==='notifications/initialized')return;
 if(mode==='exit'){process.exit(19);return;}
 if(mode==='stall'||mode==='ignore-term')return;
 if(mode==='stderr'){process.stderr.write('PRIVATE_STDERR'.repeat(2000));return;}
 if(mode==='flood'){process.stdout.write('x'.repeat(600000));return;}
 if(mode==='utf8'){process.stdout.write(Buffer.from([0xff,0x0a]));return;}
 if(mode==='duplicate'){process.stdout.write('{"jsonrpc":"2.0","id":'+request.id+',"id":'+request.id+',"result":{}}\n');return;}
 if(mode==='notification'){send({jsonrpc:'2.0',method:'notifications/tools/list_changed',params:{PRIVATE:'never return'}});return;}
 if(mode==='server-request'){send({jsonrpc:'2.0',id:999,method:'sampling/createMessage',params:{PRIVATE:'never return'}});return;}
 if(mode==='partial'){process.stdout.write('{"jsonrpc":');process.stdout.end();return;}
 const result=request.method==='initialize'?{protocolVersion:'2025-11-25',capabilities:{tools:{}},serverInfo:{name:'labs-fixture',version:'1.0.0'}}:request.params?.cursor?{tools:[]}:{tools:[{name:'read_experiment',inputSchema:{type:'object',properties:{}}}],nextCursor:'second'};
 if(mode==='wrong-id'){send({jsonrpc:'2.0',id:999,result});return;}
 if(mode==='extra'){send({jsonrpc:'2.0',id:request.id,result,PRIVATE:'extra'});return;}
 send({jsonrpc:'2.0',id:request.id,result});
 if(mode==='multiple')send({jsonrpc:'2.0',id:request.id,result});
});
