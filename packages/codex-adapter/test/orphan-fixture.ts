// Launched only by the offline test. Synthetic Node child, never Codex.
import { writeFile } from 'node:fs/promises';
import { startGuardian } from '../src/supervisor.js';
const cwd=process.argv[2]!;
const owned=await startGuardian({executable:process.execPath,argv:['-e','setInterval(()=>{},1000)'],cwd,env:{PATH:'/usr/bin:/bin'},seconds:20,stdoutBytes:1024,stderrBytes:1024},new AbortController().signal,()=>{});
await writeFile(`${cwd}/owned.json`,JSON.stringify({pid:owned.identity.pid,guardianPid:owned.guardianPid}));
setInterval(()=>{},1000);
