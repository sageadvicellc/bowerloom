import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,realpathSync,chmodSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import https from 'node:https';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
import {mcpBindingRevision,mcpRevocationRevision,validateMcpAccessToken} from '../../../dist/packages/mcp-connections/src/index.js';

// Resource-side fixture only. No production connector or credential store is installed.
test('loopback TLS resource refuses wrong token claims and updated revocations before returning its synthetic catalog',{timeout:15000},async t=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'bowerloom-auth-tls-')));chmodSync(root,0o700);t.after(()=>rmSync(root,{recursive:true,force:true}));
 const keyFile=join(root,'test-key.pem'),certFile=join(root,'test-cert.pem');
 const tlsResult=spawnSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',keyFile,'-out',certFile,'-days','1','-subj','/CN=127.0.0.1','-addext','subjectAltName=IP:127.0.0.1'],{encoding:'utf8',timeout:10000});
 assert.equal(tlsResult.status,0,'Synthetic TLS certificate generation failed');chmodSync(keyFile,0o600);
 const tlsKey=readFileSync(keyFile),cert=readFileSync(certFile);
 const pair=await generateKeyPair('RS256',{modulusLength:2048}),publicJwk=await exportJWK(pair.publicKey);
 const publicKey={kty:'RSA',kid:'fixture-key',alg:'RS256',use:'sig',n:publicJwk.n,e:publicJwk.e};
 const nowSeconds=Math.floor(Date.now()/1000),nowMs=nowSeconds*1000;
 let binding,policy,revocation,catalogReads=0;
 const server=https.createServer({key:tlsKey,cert},async(req,res)=>{
  try{
   assert.equal(req.method,'POST');assert.equal(req.url,'/mcp');
   const header=req.headers.authorization;
   if(typeof header!=='string'||!header.startsWith('Bearer '))throw Error('Unauthorized');
   const receipt=await validateMcpAccessToken({token:header.slice(7),binding,policy,revocation,nowMs,synthetic:true});
   assert.equal(receipt.signatureVerified,true);assert.equal(receipt.executionAuthorized,false);
   catalogReads++;
   res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({jsonrpc:'2.0',id:1,result:{tools:[{name:'read_experiment',inputSchema:{type:'object'}}]}}));
  }catch{
   res.writeHead(401,{'Content-Type':'application/json','WWW-Authenticate':'Bearer error="invalid_token"'}).end('{"error":"unauthorized"}');
  }
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
 const endpoint=`https://127.0.0.1:${server.address().port}/mcp`;
 binding={format:'bowerloom/mcp-binding/v1beta1',connectionId:'labs',bindingId:'synthetic-labs',protocolVersion:'2025-11-25',serverIdentity:{name:'labs-fixture',version:'1.0.0'},transport:{kind:'streamable-http',endpoint,auth:{kind:'oauth2',issuer:'https://identity.example.test/',audience:endpoint,scopes:['experiments:read'],credentialRef:'secret-ref:synthetic/labs-access'}}};
 revocation={format:'bowerloom/mcp-revocation-snapshot/v1beta1',bindingRevision:mcpBindingRevision(binding),issuer:binding.transport.auth.issuer,subject:'hanna-dummy',revocationEpoch:1,issuedAtMs:nowMs,validUntilMs:nowMs+60000,revokedTokenIds:[],revokedSubjects:[],revokedKeyIds:[]};
 policy={format:'bowerloom/mcp-token-policy/v1beta1',bindingRevision:mcpBindingRevision(binding),subject:'hanna-dummy',clientId:'fixture-client',issuer:binding.transport.auth.issuer,audience:endpoint,publicKeys:[publicKey],maxTokenLifetimeSeconds:600,maxTokenAgeSeconds:600,maxRevocationAgeSeconds:60,revocationEpoch:1,revocationRevision:mcpRevocationRevision(revocation)};
 const claims={iss:policy.issuer,aud:policy.audience,sub:policy.subject,client_id:policy.clientId,scope:'experiments:read',iat:nowSeconds-5,nbf:nowSeconds-5,exp:nowSeconds+300,jti:'synthetic-token-one'};
 const sign=changes=>new SignJWT({...claims,...changes}).setProtectedHeader({alg:'RS256',typ:'at+jwt',kid:'fixture-key'}).sign(pair.privateKey);
 const request=token=>new Promise((resolve,reject)=>{
  const req=https.request(endpoint,{method:'POST',ca:cert,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})}},res=>{
   let body='';res.on('data',chunk=>{body+=chunk;if(body.length>16384){res.destroy();reject(Error('Fixture response bound'));}});res.on('error',reject);res.on('end',()=>resolve({status:res.statusCode,body}));
  });req.on('error',reject);req.end('{"jsonrpc":"2.0","id":1,"method":"tools/list"}');
 });
 const valid=await sign({}),accepted=await request(valid);assert.equal(accepted.status,200);assert.equal(catalogReads,1);
 const failures=[null,await sign({aud:'https://other.example.test/'}),await sign({iss:'https://other-issuer.example.test/'}),await sign({sub:'miki-dummy'}),await sign({client_id:'other-client'}),await sign({scope:'experiments:read drafts:write'}),await sign({exp:nowSeconds-1})];
 for(const token of failures){const result=await request(token);assert.equal(result.status,401);assert.equal(result.body,'{"error":"unauthorized"}');if(token)assert.ok(!result.body.includes(token));}
 assert.equal(catalogReads,1);
 const oldSnapshot=structuredClone(revocation);
 revocation={...revocation,revocationEpoch:2,revokedTokenIds:['synthetic-token-one']};
 policy={...policy,revocationEpoch:2,revocationRevision:mcpRevocationRevision(revocation)};
 assert.equal((await request(valid)).status,401);assert.equal(catalogReads,1);
 revocation=oldSnapshot;
 assert.equal((await request(valid)).status,401);assert.equal(catalogReads,1);
 console.log(JSON.stringify({proof:'synthetic-resource-token-validation-over-loopback-TLS',acceptedCatalogs:catalogReads,rejectedRequests:9,updatedRevocation:true,staleSnapshotRejected:true,externalRequests:0,toolCalls:0,productionOAuthFlow:false}));
});
