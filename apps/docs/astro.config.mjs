import {defineConfig} from 'astro/config';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({
  site: 'https://bowerloom.ai', base: '/docs', trailingSlash: 'always', output: 'static',
  integrations: [react()],
  vite: {define: {__BOWERLOOM_DOCS_SOURCE_ROOT__: JSON.stringify(new URL('./',import.meta.url).href)}, plugins: [tailwindcss()], ssr: {noExternal: ['fumadocs-core', 'fumadocs-ui']}, optimizeDeps: {exclude: ['fumadocs-core', 'fumadocs-ui']}},
});
