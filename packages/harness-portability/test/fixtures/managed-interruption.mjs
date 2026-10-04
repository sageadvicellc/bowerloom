import fs from 'node:fs';
import {join} from 'node:path';
import {applyManagedProjection,removeManagedProjection} from '../../../../dist/packages/harness-portability/src/index.js';
const request=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const originalRename=fs.renameSync,originalClose=fs.closeSync,originalOpen=fs.openSync,opened=new Map();
fs.openSync=function(path,...args){const fd=originalOpen.call(this,path,...args);opened.set(fd,String(path));return fd;};
fs.closeSync=function(fd){const file=opened.get(fd);const result=originalClose.call(this,fd);opened.delete(fd);if(request.mode==='edit-after-stamp'&&file?.endsWith('-stage.json'))fs.writeFileSync(request.input.file,'# unrelated concurrent change\nchanged = true\n');return result;};
fs.renameSync=function(from,to){
 if(String(to)===request.file){
  if(request.mode==='before')process.kill(process.pid,'SIGKILL');
  if(request.mode==='pause'){fs.writeFileSync(request.marker,'ready');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,30000);}
  const result=originalRename.call(this,from,to);
  if(request.mode==='after')process.kill(process.pid,'SIGKILL');
  return result;
 }
 return originalRename.call(this,from,to);
};
try{
 const value=request.operation==='install'?await applyManagedProjection(request.input,request.revision):await removeManagedProjection({stateDir:request.stateDir},request.revision);
 process.stdout.write(JSON.stringify(value));
}catch(error){process.stderr.write(String(error.code??error.message));process.exitCode=2;}
