// Synthetic test server only. No tool invocation handler or external effects.
import {readFileSync} from 'node:fs';
import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {ListToolsRequestSchema} from '@modelcontextprotocol/sdk/types.js';
const catalog=JSON.parse(readFileSync(new URL('../fixtures/stdio-catalog.json',import.meta.url),'utf8'));
const server=new Server(catalog.serverIdentity,{capabilities:{tools:{listChanged:true}}});
let ready=false;
server.oninitialized=()=>{ready=true;};
server.setRequestHandler(ListToolsRequestSchema,async request=>{
 if(!ready)throw Error('Initialization required');
 if(request.params?.cursor===undefined)return {tools:catalog.tools.slice(0,1),nextCursor:'second'};
 if(request.params.cursor==='second')return {tools:catalog.tools.slice(1)};
 throw Error('Unknown cursor');
});
await server.connect(new StdioServerTransport());
process.stdin.on('end',()=>{void server.close();});
