// These paths are used only while building static pages and local verification.
// Astro relocates server modules into dist/.prerender, so its configuration pins
// the original docs source root. Direct Node checks retain their source URL.
export function documentationSources(moduleUrl,configuredRoot) {
  const root=configuredRoot?new URL(configuredRoot):new URL('../../',moduleUrl);
  return {release:new URL('../../release/beta.json',root),content:new URL('src/content/docs/',root)};
}
export const sourcePaths=documentationSources(import.meta.url,
  typeof __BOWERLOOM_DOCS_SOURCE_ROOT__==='string'?__BOWERLOOM_DOCS_SOURCE_ROOT__:undefined);
