import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync, rmSync, readdirSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArticle, loadArticles, renderArticlePage, renderIndexPage, renderSitemap, renderRobots, buildFiles, articlesPlugin} from '../build/articles.ts';
import {renderMarkdown, safeHref} from '../build/markdown.ts';
import {release} from '../src/release.ts';
import social from '../../../release/social-preview.json' with {type: 'json'};

const site = {site: release.urls.site, docs: release.urls.docs, repository: release.urls.repository, image: social.image};
const fm = (extra = {}, body = 'Body text.') => {
  const base = {title: 'A title', description: 'A description.', date: '2026-01-05', author: 'Test Author', ...extra};
  const lines = Object.entries(base).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}: ${v}`);
  return `---\n${lines.join('\n')}\n---\n${body}\n`;
};
const folder = files => {
  const dir = mkdtempSync(join(tmpdir(), 'articles-'));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
};
const ldOf = html => JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
const metaOf = (html, key) => html.match(new RegExp(`<meta (?:property|name)="${key}" content="([^"]*)">`))?.[1];

test('front matter validation names the file and the problem', () => {
  const bad = [
    ['no front matter', 'x.md', 'just text', /missing front matter/],
    ['missing title', 'x.md', fm({title: undefined}), /"title" is required/],
    ['missing author', 'x.md', fm({author: undefined}), /"author" is required/],
    ['empty author', 'x.md', fm({author: ''}), /"author" is required/],
    ['bad date format', 'x.md', fm({date: '05/01/2026'}), /"date" must be a real date/],
    ['impossible date', 'x.md', fm({date: '2026-02-31'}), /"date" must be a real date/],
    ['bad updated', 'x.md', fm({updated: 'soon'}), /"updated" must be a real date/],
    ['updated before date', 'x.md', fm({updated: '2025-12-31'}), /not be before/],
    ['bad draft', 'x.md', fm({draft: 'yes'}), /"draft" must be true or false/],
    ['unknown key', 'x.md', fm({tags: 'a'}), /unknown front matter key "tags"/],
    ['duplicate key', 'x.md', fm().replace('---\n', '---\ntitle: Again\n'), /duplicate/],
    ['bad slug', 'Bad Name.md', fm(), /lowercase slug/],
    ['empty body', 'x.md', fm({}, ''), /body is empty/],
    ['junk line', 'x.md', '---\nnot a pair\n---\nbody', /not "key: value"/],
  ];
  for (const [label, file, text, pattern] of bad) {
    assert.throws(() => parseArticle(file, text), err => pattern.test(err.message) && err.message.includes(`"${file}"`), label);
  }
});

test('valid front matter parses, with quoted values and optional fields', () => {
  const a = parseArticle('hello-world.md', fm({title: '"Quoted: title"', updated: '2026-02-01', draft: 'false'}));
  assert.deepEqual({slug: a.slug, title: a.title, author: a.author, updated: a.updated, draft: a.draft}, {slug: 'hello-world', title: 'Quoted: title', author: 'Test Author', updated: '2026-02-01', draft: false});
});

test('drafts, future-dated files, and the README are excluded; order is newest first', () => {
  const dir = folder({
    'README.md': '# not an article',
    'old.md': fm({date: '2026-01-01'}),
    'new.md': fm({date: '2026-03-01'}),
    'draft.md': fm({date: '2026-02-01', draft: 'true'}),
    'future.md': fm({date: '2027-01-01'}),
  });
  try {
    assert.deepEqual(loadArticles(dir, '2026-06-01').map(a => a.slug), ['new', 'old']);
    assert.deepEqual(loadArticles(dir, '2027-01-01').map(a => a.slug), ['future', 'new', 'old']);
    assert.equal(loadArticles(join(dir, 'missing'), '2026-06-01').length, 0);
  } finally { rmSync(dir, {recursive: true}); }
});

test('a bad article in the folder fails loading, even when it is a draft', () => {
  const dir = folder({'bad.md': fm({date: 'nope', draft: 'true'})});
  try { assert.throws(() => loadArticles(dir, '2026-06-01'), /bad\.md/); } finally { rmSync(dir, {recursive: true}); }
});

test('empty state is plain, linked, and a valid page with its own metadata', () => {
  const html = renderIndexPage(site, []);
  assert.match(html, /There are no articles yet\./);
  assert.ok(html.includes(`href="${release.urls.docs}"`));
  assert.ok(html.includes(`href="${release.urls.repository}"`));
  assert.match(html, /<link rel="canonical" href="https:\/\/bowerloom\.ai\/articles\/">/);
  assert.equal(metaOf(html, 'og:url'), 'https://bowerloom.ai/articles/');
  assert.equal(metaOf(html, 'og:type'), 'website');
  assert.ok(metaOf(html, 'description'));
  assert.doesNotMatch(html, /<li>|<article/);
});

test('index lists published articles with links, titles, and bylines', () => {
  const a = parseArticle('first.md', fm({title: 'First <post>', author: 'Fixture Writer'}));
  const html = renderIndexPage(site, [a]);
  assert.match(html, /href="\/articles\/first\/"/);
  assert.match(html, /First &lt;post&gt;/);
  assert.match(html, /By Fixture Writer/);
  assert.doesNotMatch(html, /no articles yet/);
});

test('article page carries canonical, Open Graph, Twitter, byline, links, and JSON-LD', () => {
  const a = parseArticle('first-post.md', fm({title: 'First post', author: 'Fixture Writer', updated: '2026-02-01'}, '# Heading\n\nHello **world**.'));
  const html = renderArticlePage(site, a);
  const url = 'https://bowerloom.ai/articles/first-post/';
  assert.match(html, /<title>First post · Bowerloom<\/title>/);
  assert.match(html, new RegExp(`<link rel="canonical" href="${url}">`));
  assert.equal(metaOf(html, 'description'), 'A description.');
  assert.equal(metaOf(html, 'og:type'), 'article');
  assert.equal(metaOf(html, 'og:title'), 'First post · Bowerloom');
  assert.equal(metaOf(html, 'og:url'), url);
  assert.equal(metaOf(html, 'og:image'), social.image.url);
  assert.equal(metaOf(html, 'article:published_time'), '2026-01-05');
  assert.equal(metaOf(html, 'article:modified_time'), '2026-02-01');
  assert.equal(metaOf(html, 'twitter:card'), 'summary_large_image');
  assert.match(html, /By Fixture Writer/);
  assert.match(html, /Agents helped draft this article\./);
  assert.match(html, /<h2>Heading<\/h2>/);
  assert.match(html, /<strong>world<\/strong>/);
  for (const href of ['href="/"', 'href="/articles/"', `href="${release.urls.docs}"`]) assert.ok(html.includes(href), href);
  const ld = ldOf(html);
  assert.equal(ld['@type'], 'Article');
  assert.equal(ld.headline, 'First post');
  assert.equal(ld.description, 'A description.');
  assert.equal(ld.datePublished, '2026-01-05');
  assert.equal(ld.dateModified, '2026-02-01');
  assert.deepEqual(ld.author, {'@type': 'Person', name: 'Fixture Writer'});
  assert.equal(ld.publisher['@type'], 'Organization');
  assert.equal(ld.publisher.name, 'Bowerloom');
  assert.equal(ld.mainEntityOfPage['@id'], url);
  assert.deepEqual(ld.image, [social.image.url]);
});

test('without "updated" there is no modified_time tag and dateModified falls back to the date', () => {
  const html = renderArticlePage(site, parseArticle('a.md', fm()));
  assert.equal(metaOf(html, 'article:modified_time'), undefined);
  assert.equal(ldOf(html).dateModified, '2026-01-05');
});

test('the byline name comes from the article, never from the template', () => {
  const html = renderArticlePage(site, parseArticle('a.md', fm({author: 'Zed Quill'})));
  assert.match(html, /By Zed Quill/);
  assert.equal(ldOf(html).author.name, 'Zed Quill');
});

test('hostile titles, authors, and descriptions are escaped in HTML and JSON-LD', () => {
  const evil = '</script><script>alert(1)</script>';
  const a = parseArticle('evil.md', fm({title: `"${evil} \\"q\\""`, author: `"${evil}"`, description: `"x\\" onload=\\"alert(1) ${evil}"`}));
  const html = renderArticlePage(site, a);
  assert.doesNotMatch(html, /<script>alert/);
  assert.equal((html.match(/<script/g) ?? []).length, 2, 'only the two known script tags');
  assert.doesNotMatch(html, /" onload="/);
  const ld = ldOf(html);
  assert.ok(ld.headline.includes(evil));
  assert.ok(ld.author.name.includes(evil));
  assert.doesNotMatch(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1], /[<>]/);
});

test('markdown escapes raw HTML and drops unsafe links', () => {
  const html = renderMarkdown([
    '<script>alert(1)</script>', '', '<img src=x onerror=alert(1)>', '',
    '[bad](javascript:alert(1)) [data](data:text/html,x) [ok](https://example.com/a?b=1&c=2) [rel](/docs/) [anchor](#top)',
    '', '[quote](https://example.com/"onclick="x)', '', '```', '<b>code</b>', '```',
  ].join('\n'));
  assert.doesNotMatch(html, /<script|<img|<b>/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /javascript:|data:text/);
  assert.match(html, /<a href="https:\/\/example\.com\/a\?b=1&amp;c=2" rel="noopener">ok<\/a>/);
  assert.match(html, /<a href="\/docs\/">rel<\/a>/);
  assert.match(html, /<a href="#top">anchor<\/a>/);
  assert.doesNotMatch(html, /"onclick="/);
  assert.match(html, /<pre><code>&lt;b&gt;code&lt;\/b&gt;<\/code><\/pre>/);
});

test('safeHref accepts http(s) and relative only', () => {
  for (const ok of ['https://a.test/x', 'http://a.test', '/x', './x', '../x', '#a', 'page/']) assert.equal(safeHref(ok), ok, ok);
  for (const no of ['javascript:alert(1)', 'JaVaScRiPt:x', 'data:text/html,x', 'mailto:a@b.test', 'vbscript:x', '//evil.test', ' java\nscript:x', '', 'ftp://a.test']) assert.equal(safeHref(no), null, JSON.stringify(no));
});

test('markdown renders lists, quotes, rules, and demotes headings below the page title', () => {
  const html = renderMarkdown('# One\n\n- a\n- b\n\n1. x\n2. y\n\n> quoted\n\n---\n\npara\ncontinues');
  assert.match(html, /<h2>One<\/h2>/);
  assert.match(html, /<ul><li>a<\/li><li>b<\/li><\/ul>/);
  assert.match(html, /<ol><li>x<\/li><li>y<\/li><\/ol>/);
  assert.match(html, /<blockquote><p>quoted<\/p><\/blockquote>/);
  assert.match(html, /<hr>/);
  assert.match(html, /<p>para continues<\/p>/);
});

test('sitemap lists home, index, and each article with lastmod, and escapes XML', () => {
  const a = parseArticle('one.md', fm({updated: '2026-02-01'}));
  const b = parseArticle('two.md', fm({date: '2026-03-01'}));
  const xml = renderSitemap(site, [b, a]);
  assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>/);
  assert.match(xml, /<loc>https:\/\/bowerloom\.ai\/<\/loc>/);
  assert.match(xml, /<loc>https:\/\/bowerloom\.ai\/articles\/<\/loc><lastmod>2026-03-01<\/lastmod>/);
  assert.match(xml, /<loc>https:\/\/bowerloom\.ai\/articles\/one\/<\/loc><lastmod>2026-02-01<\/lastmod>/);
  assert.match(xml, /<loc>https:\/\/bowerloom\.ai\/articles\/two\/<\/loc><lastmod>2026-03-01<\/lastmod>/);
  assert.doesNotMatch(xml, /\/docs/);
  const odd = renderSitemap({...site, site: 'https://a.test/?x=1&y=2'}, []);
  assert.match(odd, /&amp;y=2/);
  const empty = renderSitemap(site, []);
  assert.equal((empty.match(/<url>/g) ?? []).length, 2);
  assert.doesNotMatch(empty, /lastmod/);
});

test('robots allows all and names the sitemap', () => {
  assert.equal(renderRobots(site), 'User-agent: *\nAllow: /\n\nSitemap: https://bowerloom.ai/sitemap.xml\n');
});

test('buildFiles emits one page per article plus index, sitemap, and robots', () => {
  const files = buildFiles(site, [parseArticle('one.md', fm())]);
  assert.deepEqual(Object.keys(files).sort(), ['articles/index.html', 'articles/one/index.html', 'robots.txt', 'sitemap.xml']);
});

test('the plugin emits assets from a fixture folder', () => {
  const dir = folder({'one.md': fm({date: '2020-01-01'}), 'later.md': fm({date: '2999-01-01'})});
  try {
    const emitted = [];
    articlesPlugin(site, dir).generateBundle.call({emitFile: f => emitted.push(f.fileName)});
    assert.deepEqual(emitted.sort(), ['articles/index.html', 'articles/one/index.html', 'robots.txt', 'sitemap.xml']);
  } finally { rmSync(dir, {recursive: true}); }
});

test('the real content folder ships without articles and builds index, sitemap, and robots only', () => {
  const dir = fileURLToPath(new URL('../content/articles', import.meta.url));
  const names = readdirSync(dir).filter(f => f.endsWith('.md') && f !== 'README.md');
  assert.deepEqual(names, [], 'no article content ships in this change');
  const emitted = [];
  articlesPlugin(site, dir).generateBundle.call({emitFile: f => emitted.push(f.fileName)});
  assert.deepEqual(emitted.sort(), ['articles/index.html', 'robots.txt', 'sitemap.xml']);
});

test('navigation links to the articles index', () => {
  const nav = readFileSync(new URL('../src/SiteNavigation.tsx', import.meta.url), 'utf8');
  assert.match(nav, /<a href="\/articles\/"[^>]*>Articles<\/a>/);
});
