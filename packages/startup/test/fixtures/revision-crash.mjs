import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
const [inputPath,from,revision,checkpoint,action] = process.argv.slice(2);
const input=JSON.parse(fs.readFileSync(inputPath,'utf8')), paths=new Map();
const open=fs.openSync, write=fs.writeFileSync, rename=fs.renameSync;
fs.openSync=function(path,...rest){const fd=open.call(this,path,...rest);paths.set(fd,String(path));return fd;};
fs.writeFileSync=function(path,...rest){const result=write.call(this,path,...rest);const name=typeof path==='number'?paths.get(path):String(path);
  const hit = checkpoint==='journal'&&name?.endsWith('/.bowerloom-revision.json')
    ||checkpoint==='stage'&&name?.endsWith('/stage.json')
    ||checkpoint==='file'&&name?.includes('/next/START-HERE.md')
    ||checkpoint==='prepared'&&name?.endsWith('/prepared')
    ||checkpoint==='rollback'&&name?.endsWith('/rollback')
    ||checkpoint==='result'&&name?.endsWith('/result.json');
  if(hit)process.exit(86); return result;
};
fs.renameSync=function(from,to){const result=rename.call(this,from,to);
  if(checkpoint==='old-moved'&&String(to).endsWith('/previous')||checkpoint==='new-moved'&&String(from).endsWith('/next')
    ||checkpoint==='rollback-new-moved'&&String(to).endsWith('/next')
    ||checkpoint==='rollback-old-restored'&&String(from).endsWith('/previous')
    ||checkpoint==='archived'&&String(to).endsWith('/journal.json'))process.exit(86);return result;
};
syncBuiltinESMExports();
const {applyStartupRevision,recoverStartupRevision}=await import('../../../../dist/packages/startup/src/index.js');
if(action)await recoverStartupRevision(input.targetDir,revision,action);else await applyStartupRevision(input,from,revision);
throw Error('Checkpoint not reached');
