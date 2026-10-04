import { BackendError, doctorBackend, installBackend, planBackend, statusBackend } from '../../../packages/local-backend/src/index.js';
import type { BackendInput, Dependencies } from '../../../packages/local-backend/src/index.js';
export async function runBackendCommand(args: string[], dependencies: Dependencies = {}): Promise<object> {
  if (args[0] !== 'backend' || !['doctor', 'plan', 'install', 'status'].includes(args[1] ?? '')) throw new BackendError('BACKEND_USAGE');
  const action = args[1];
  if (action === 'doctor') { if (args.length !== 2) throw new BackendError('BACKEND_USAGE'); return doctorBackend(dependencies); }
  const flags = new Map<string, string>();
  for (let index = 2; index < args.length; index += 2) {
    const key = args[index]!, value = args[index + 1];
    if (!['--root', '--studio-port', '--database-port', '--approve'].includes(key) || flags.has(key) || !value || value.startsWith('--')) throw new BackendError('BACKEND_USAGE');
    flags.set(key, value);
  }
  const rootDir = flags.get('--root'); if (!rootDir) throw new BackendError('BACKEND_USAGE');
  if (action === 'status') { if (flags.size !== 1) throw new BackendError('BACKEND_USAGE'); return statusBackend(rootDir, dependencies); }
  const input: BackendInput = { rootDir };
  for (const [flag, field] of [['--studio-port', 'studioPort'], ['--database-port', 'databasePort']] as const) {
    const value = flags.get(flag); if (value !== undefined) { if (!/^[0-9]{4,5}$/.test(value)) throw new BackendError('BACKEND_USAGE'); input[field] = Number(value); }
  }
  if (action === 'plan') { if (flags.has('--approve')) throw new BackendError('BACKEND_USAGE'); return planBackend(input, dependencies); }
  const approval = flags.get('--approve'); if (!approval) throw new BackendError('EXACT_APPROVAL_REQUIRED');
  return installBackend(input, approval, dependencies);
}
