// Tells a persona session when the built app is older than its source, so a round never judges a stale build. Reads files only.
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SOURCE_FOLDERS = ['main', 'preload', 'renderer', 'shared'];
const SOURCE = /\.(?:tsx?|mjs|cjs|css|html)$/;

function newestSource(desktop) {
  let newest = 0;
  for (const folder of SOURCE_FOLDERS) {
    const base = join(desktop, folder);
    if (!existsSync(base)) continue;
    for (const entry of readdirSync(base, { recursive: true, withFileTypes: true })) {
      if (entry.isFile() && SOURCE.test(entry.name)) newest = Math.max(newest, statSync(join(entry.parentPath, entry.name)).mtimeMs);
    }
  }
  return newest;
}

/** Answers null when the build is there and current, or a plain sentence that says what to do. */
export function staleReason(desktop) {
  const built = [join(desktop, 'dist', 'main.mjs'), join(desktop, 'dist', 'renderer', 'app.js')];
  if (built.some(f => !existsSync(f))) return 'The app is not built. Run: npm --prefix apps/desktop run bundle';
  const oldest = Math.min(...built.map(f => statSync(f).mtimeMs));
  return newestSource(desktop) > oldest ? 'The built app is older than its source. Run: npm --prefix apps/desktop run bundle' : null;
}
