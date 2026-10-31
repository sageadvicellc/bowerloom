import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

/** Loads the page components through Vite's server renderer, so a test can render them to HTML without a browser. */
export async function loadPage() {
  const server = await createServer({
    root: fileURLToPath(new URL('..', import.meta.url)),
    logLevel: 'silent', appType: 'custom', server: { middlewareMode: true, hmr: false, watch: null },
  });
  const [sections, hero, release] = await Promise.all([
    server.ssrLoadModule('/src/Sections.tsx'),
    server.ssrLoadModule('/src/Hero.tsx'),
    server.ssrLoadModule('/src/release.ts'),
  ]);
  return { sections, hero, release, close: () => server.close() };
}
