import { spawn } from 'node:child_process';
import { fail } from './model.js';
export const validBootSession = (v: unknown): v is string => typeof v === 'string' && /^[A-F0-9]{8}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{12}$/.test(v);
/** Real kernel observation only. No caller-provided host identity, executable or environment. */
export async function readDarwinBootSession(): Promise<string> {
  if (process.platform !== 'darwin' || process.permission !== undefined) fail('MCP_GUARDIAN_BOOT_UNKNOWN');
  return new Promise((resolve, reject) => {
    let done = false, bytes = Buffer.alloc(0), failed = false, stderr = false, fallback: ReturnType<typeof setTimeout> | undefined;
    const child = spawn('/usr/sbin/sysctl', ['-n', 'kern.bootsessionuuid'], { env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', NODE_V8_COVERAGE: undefined }, stdio: ['ignore', 'pipe', 'pipe'], shell: false });
    const finish = (code: number | null) => {
      if (done) return; done = true; clearTimeout(timer); clearTimeout(fallback);
      const text = bytes.toString('utf8').trim();
      if (failed || stderr || code !== 0 || !validBootSession(text) || !bytes.equals(Buffer.from(bytes.toString('utf8')))) reject(Error('MCP_GUARDIAN_BOOT_UNKNOWN')); else resolve(text);
    };
    const stop = () => { if (failed || done) return; failed = true; try { child.kill('SIGKILL'); } catch {} fallback = setTimeout(() => { child.stdout.destroy(); child.stderr.destroy(); child.unref(); finish(null); }, 250); };
    const timer = setTimeout(stop, 2000);
    child.on('error', stop); child.stdout.on('error', stop); child.stderr.on('error', stop);
    child.stdout.on('data', (chunk: Buffer) => { if (done) return; if (bytes.length + chunk.length > 128) stop(); else bytes = Buffer.concat([bytes, chunk]); });
    child.stderr.on('data', () => { stderr = true; stop(); }); child.once('close', finish);
  });
}
