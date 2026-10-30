import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { escapeHtml, renderMarkdown } from './markdown.ts';

export type Article = {
  slug: string; title: string; description: string; date: string;
  author: string; updated?: string; draft: boolean; body: string;
};
export type SiteInfo = {
  site: string; docs: string; repository: string;
  image: { url: string; width: number; height: number; type: string; alt: string };
};

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const KEYS = new Set(['title', 'description', 'date', 'author', 'updated', 'draft']);
export const AGENT_NOTE = 'Agents helped draft this article.';

const validDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
};

export function parseArticle(file: string, source: string): Article {
  const fail = (message: string): never => { throw new Error(`Article "${file}": ${message}`); };
  const slug = file.replace(/\.md$/, '');
  if (!SLUG.test(slug)) fail('file name must be a lowercase slug such as "my-article.md"');
  const match = /^---\n([\s\S]*?)\n---(?:\n([\s\S]*))?$/.exec(source.replace(/\r\n?/g, '\n').replace(/^\uFEFF/, ''));
  if (!match) return fail('missing front matter block between two "---" lines');
  const data = new Map<string, string>();
  for (const line of match[1].split('\n')) {
    if (line.trim() === '') continue;
    const pair = /^([A-Za-z][A-Za-z0-9_]*):[ \t]*(.*)$/.exec(line);
    if (!pair) { fail(`front matter line is not "key: value": ${JSON.stringify(line)}`); continue; }
    const [, key, raw] = pair;
    if (!KEYS.has(key)) fail(`unknown front matter key "${key}"`);
    if (data.has(key)) fail(`duplicate front matter key "${key}"`);
    let value = raw.trim();
    if (/^".*"$/.test(value) && value.length >= 2) {
      try { value = JSON.parse(value); } catch { fail(`"${key}" has a bad quoted string`); }
    } else if (/^'.*'$/.test(value) && value.length >= 2) value = value.slice(1, -1).replaceAll("''", "'");
    data.set(key, value);
  }
  const need = (key: string, max: number) => {
    const value = data.get(key);
    if (!value) fail(`"${key}" is required`);
    if (value!.length > max) fail(`"${key}" is longer than ${max} characters`);
    return value!;
  };
  const title = need('title', 160);
  const description = need('description', 320);
  const author = need('author', 100);
  const date = need('date', 10);
  if (!validDate(date)) fail(`"date" must be a real date as YYYY-MM-DD, got ${JSON.stringify(date)}`);
  const updated = data.get('updated');
  if (updated !== undefined) {
    if (!validDate(updated)) fail(`"updated" must be a real date as YYYY-MM-DD, got ${JSON.stringify(updated)}`);
    if (updated < date) fail('"updated" must not be before "date"');
  }
  const draftRaw = data.get('draft');
  if (draftRaw !== undefined && draftRaw !== 'true' && draftRaw !== 'false') fail('"draft" must be true or false');
  const body = (match[2] ?? '').trim();
  if (!body) fail('the article body is empty');
  return { slug, title, description, date, author, updated, draft: draftRaw === 'true', body };
}

/** Reads every article in a folder. Drafts and future-dated articles are left out. */
export function loadArticles(dir: string, today: string = new Date().toISOString().slice(0, 10)): Article[] {
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).filter(f => f.endsWith('.md') && f.toLowerCase() !== 'readme.md').sort();
  const all = files.map(f => parseArticle(f, readFileSync(join(dir, f), 'utf8')));
  return all.filter(a => !a.draft && a.date <= today)
    .sort((a, b) => b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug));
}

const e = escapeHtml;
const longDate = (iso: string) =>
  new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));
const base = (site: SiteInfo) => site.site.replace(/\/+$/, '');
export const articleUrl = (site: SiteInfo, slug: string) => `${base(site)}/articles/${slug}/`;
export const indexUrl = (site: SiteInfo) => `${base(site)}/articles/`;

/** JSON safe to place inside a script tag. */
export const safeJson = (value: unknown): string =>
  JSON.stringify(value).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e').replaceAll('&', '\\u0026')
    .replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');

const CSS = `
@font-face{font-family:Newsreader;src:url('/fonts/newsreader/roman.ttf') format('truetype');font-weight:200 800;font-style:normal;font-display:swap}
@font-face{font-family:Newsreader;src:url('/fonts/newsreader/italic.ttf') format('truetype');font-weight:200 800;font-style:italic;font-display:swap}
@font-face{font-family:Manrope;src:url('/fonts/manrope/font.ttf') format('truetype');font-weight:200 800;font-style:normal;font-display:swap}
:root{color-scheme:light dark;--ground:#F6EEE8;--surface:#FFF9F4;--ink:#373A32;--muted:#655D61;--line:#D5C9C8;--action:#80515B;--action-ink:#FFF9F4}
@media (prefers-color-scheme:dark){:root{--ground:#27262B;--surface:#343238;--ink:#F6EEE8;--muted:#D0BEC6;--line:#665B63;--action:#E8B3BF;--action-ink:#27262B}}
:root[data-theme=light]{color-scheme:light;--ground:#F6EEE8;--surface:#FFF9F4;--ink:#373A32;--muted:#655D61;--line:#D5C9C8;--action:#80515B;--action-ink:#FFF9F4}
:root[data-theme=dark]{color-scheme:dark;--ground:#27262B;--surface:#343238;--ink:#F6EEE8;--muted:#D0BEC6;--line:#665B63;--action:#E8B3BF;--action-ink:#27262B}
*{box-sizing:border-box}
body{margin:0;background:var(--ground);color:var(--ink);font:17px/1.65 Manrope,'Segoe UI',sans-serif}
a{color:var(--action);text-underline-offset:.2em}
a:focus-visible{outline:3px solid var(--action);outline-offset:3px;border-radius:2px}
a:hover{text-decoration-thickness:2px}
.bar{display:flex;flex-wrap:wrap;gap:8px 22px;align-items:center;padding:14px clamp(16px,4vw,40px);border-bottom:1px solid var(--line);font:500 14px/1.6 Manrope,'Segoe UI',sans-serif}
.bar a{display:inline-flex;align-items:center;min-height:44px}
.bar .home{font-family:Newsreader,Georgia,serif;font-size:22px;font-weight:600;letter-spacing:-.02em;color:var(--ink);text-decoration:none;margin-right:auto}
main{max-width:calc(68ch + 2 * clamp(16px,4vw,40px));margin:0 auto;padding:clamp(28px,6vw,64px) clamp(16px,4vw,40px)}
h1,h2,h3,h4{font-family:Newsreader,Georgia,serif;letter-spacing:-.03em;line-height:1.15;text-wrap:balance}
h1{font-size:clamp(2rem,6vw,3rem);margin:0 0 .4em}
h2{font-size:1.7rem;margin:2em 0 .5em}h3{font-size:1.3rem;margin:1.6em 0 .4em}
.article-body{font-family:Newsreader,Georgia,serif;font-size:1.2rem;line-height:1.7;max-width:68ch}
.article-body p,.article-body ul,.article-body ol,.article-body pre,.article-body blockquote{margin:0 0 1.1em}
.article-body code,pre{font-family:'IBM Plex Mono',SFMono-Regular,Consolas,monospace;font-size:.85em}
pre{overflow-x:auto;padding:14px 16px;background:var(--surface);border:1px solid var(--line);border-radius:8px}
blockquote{margin-left:0;padding-left:1em;border-left:3px solid var(--line);color:var(--muted)}
.byline{color:var(--muted);font-size:15px;margin:0 0 2em}
.byline p{margin:0}
.list{list-style:none;margin:2em 0 0;padding:0}
.list li{padding:18px 0;border-top:1px solid var(--line)}
.list h2{margin:0 0 .2em;font-size:1.4rem}
.list p{margin:.2em 0}
.foot{margin-top:3em;padding-top:1.2em;border-top:1px solid var(--line);font-size:15px;display:flex;flex-wrap:wrap;gap:8px 22px}
.foot a{display:inline-flex;align-items:center;min-height:44px}
@media (prefers-reduced-motion:reduce){*{scroll-behavior:auto!important;transition:none!important;animation:none!important}}
`;

const THEME_SCRIPT = `try{var t=localStorage.getItem('bowerloom.theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}`;

type Meta = {
  title: string; description: string; canonical: string; ogType: 'website' | 'article';
  extra?: string[]; jsonLd?: unknown; main: string;
};

function page(site: SiteInfo, m: Meta): string {
  const img = site.image;
  const tags = [
    `<meta property="og:type" content="${m.ogType}">`,
    `<meta property="og:title" content="${e(m.title)}">`,
    `<meta property="og:description" content="${e(m.description)}">`,
    `<meta property="og:url" content="${e(m.canonical)}">`,
    `<meta property="og:site_name" content="Bowerloom">`,
    `<meta property="og:image" content="${e(img.url)}">`,
    `<meta property="og:image:width" content="${img.width}">`,
    `<meta property="og:image:height" content="${img.height}">`,
    `<meta property="og:image:type" content="${e(img.type)}">`,
    `<meta property="og:image:alt" content="${e(img.alt)}">`,
    ...(m.extra ?? []),
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${e(m.title)}">`,
    `<meta name="twitter:description" content="${e(m.description)}">`,
    `<meta name="twitter:image" content="${e(img.url)}">`,
    `<meta name="twitter:image:alt" content="${e(img.alt)}">`,
  ];
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${e(m.title)}</title>
<meta name="description" content="${e(m.description)}">
<link rel="canonical" href="${e(m.canonical)}">
${tags.join('\n')}
<link rel="icon" href="/brand/rose-conservatory/s4-g3-icon.svg" type="image/svg+xml">
${m.jsonLd ? `<script type="application/ld+json">${safeJson(m.jsonLd)}</script>\n` : ''}<script>${THEME_SCRIPT}</script>
<style>${CSS}</style>
</head>
<body>
<header class="bar">
<a class="home" href="/">Bowerloom</a>
<nav aria-label="Main navigation" style="display:contents">
<a href="/articles/">Articles</a>
<a href="${e(site.docs)}">Docs</a>
<a href="${e(site.repository)}" rel="noopener">GitHub</a>
</nav>
</header>
<main>
${m.main}
<nav class="foot" aria-label="Site links">
<a href="/">Home</a>
<a href="/articles/">All articles</a>
<a href="${e(site.docs)}">Docs</a>
</nav>
</main>
</body>
</html>
`;
}

export function renderArticlePage(site: SiteInfo, a: Article): string {
  const url = articleUrl(site, a.slug);
  const ld = {
    '@context': 'https://schema.org', '@type': 'Article',
    headline: a.title, description: a.description,
    datePublished: a.date, dateModified: a.updated ?? a.date,
    author: { '@type': 'Person', name: a.author },
    publisher: { '@type': 'Organization', name: 'Bowerloom', url: base(site) + '/' },
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    image: [site.image.url],
  };
  const extra = [
    `<meta property="article:published_time" content="${e(a.date)}">`,
    ...(a.updated ? [`<meta property="article:modified_time" content="${e(a.updated)}">`] : []),
    `<meta property="article:author" content="${e(a.author)}">`,
  ];
  const main = `<article>
<h1>${e(a.title)}</h1>
<div class="byline">
<p>By ${e(a.author)} · <time datetime="${e(a.date)}">${e(longDate(a.date))}</time>${a.updated ? ` · Updated <time datetime="${e(a.updated)}">${e(longDate(a.updated))}</time>` : ''}</p>
<p>${AGENT_NOTE}</p>
</div>
<div class="article-body">
${renderMarkdown(a.body)}
</div>
</article>`;
  return page(site, { title: `${a.title} · Bowerloom`, description: a.description, canonical: url, ogType: 'article', extra, jsonLd: ld, main });
}

export function renderIndexPage(site: SiteInfo, articles: Article[]): string {
  const list = articles.length === 0
    ? `<p>There are no articles yet.</p>
<p>Read the <a href="${e(site.docs)}">documentation</a> or follow the work in the <a href="${e(site.repository)}" rel="noopener">GitHub repository</a>.</p>`
    : `<ul class="list">
${articles.map(a => `<li><h2><a href="/articles/${e(a.slug)}/">${e(a.title)}</a></h2><p>${e(a.description)}</p><p class="byline">By ${e(a.author)} · <time datetime="${e(a.date)}">${e(longDate(a.date))}</time></p></li>`).join('\n')}
</ul>`;
  const description = 'Articles from the Bowerloom project.';
  const main = `<h1>Articles</h1>\n${list}`;
  const jsonLd = { '@context': 'https://schema.org', '@type': 'CollectionPage', name: 'Bowerloom articles', url: indexUrl(site), description };
  return page(site, { title: 'Articles · Bowerloom', description, canonical: indexUrl(site), ogType: 'website', jsonLd, main });
}

const xml = (v: string) => v.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');

export function renderSitemap(site: SiteInfo, articles: Article[]): string {
  const latest = articles.map(a => a.updated ?? a.date).sort().at(-1);
  const entry = (loc: string, lastmod?: string) => `  <url><loc>${xml(loc)}</loc>${lastmod ? `<lastmod>${xml(lastmod)}</lastmod>` : ''}</url>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${[entry(base(site) + '/'), entry(indexUrl(site), latest), ...articles.map(a => entry(articleUrl(site, a.slug), a.updated ?? a.date))].join('\n')}
</urlset>
`;
}

export const renderRobots = (site: SiteInfo) => `User-agent: *\nAllow: /\n\nSitemap: ${base(site)}/sitemap.xml\n`;

/** Emitted file name to content, for a set of published articles. */
export function buildFiles(site: SiteInfo, articles: Article[]): Record<string, string> {
  return {
    'articles/index.html': renderIndexPage(site, articles),
    ...Object.fromEntries(articles.map(a => [`articles/${a.slug}/index.html`, renderArticlePage(site, a)])),
    'sitemap.xml': renderSitemap(site, articles),
    'robots.txt': renderRobots(site),
  };
}

export function articlesPlugin(site: SiteInfo, dir: string) {
  return {
    name: 'landing-articles',
    apply: 'build' as const,
    generateBundle(this: { emitFile: (f: { type: 'asset'; fileName: string; source: string }) => void }) {
      for (const [fileName, source] of Object.entries(buildFiles(site, loadArticles(dir)))) {
        this.emitFile({ type: 'asset', fileName, source });
      }
    },
  };
}
