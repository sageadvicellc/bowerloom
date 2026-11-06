// Small markdown renderer. Every character is escaped before it reaches the
// output, so raw HTML in an article is shown as text and never runs.
export const escapeHtml = (value: string): string =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');

/** Returns a safe href, or null when the target is not http(s) or relative. */
export function safeHref(raw: string): string | null {
  const url = raw.trim().replaceAll('\\', '/');
  if (!url || /[\u0000-\u001f\u007f\s]/.test(url)) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? url : null;
    } catch { return null; }
  }
  if (url.startsWith('//')) return null;
  return url;
}

const INLINE = /`([^`]+)`|\[([^\]]+)\]\(((?:[^()]|\([^()]*\))*)\)|\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*/g;

export function renderInline(text: string): string {
  let out = '';
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    out += escapeHtml(text.slice(last, m.index));
    last = m.index + m[0].length;
    if (m[1] !== undefined) out += `<code>${escapeHtml(m[1])}</code>`;
    else if (m[2] !== undefined) {
      const href = safeHref(m[3]);
      const label = renderInline(m[2]);
      out += href === null ? label
        : /^https?:/i.test(href) ? `<a href="${escapeHtml(href)}" rel="noopener">${label}</a>`
        : `<a href="${escapeHtml(href)}">${label}</a>`;
    } else if (m[4] !== undefined) out += `<strong>${renderInline(m[4])}</strong>`;
    else out += `<em>${renderInline(m[5])}</em>`;
  }
  return out + escapeHtml(text.slice(last));
}

/** The page title is the only h1, so `#` and `##` both become h2 and deeper levels keep their number: the outline never skips a level. */
export function renderMarkdown(source: string): string {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const html: string[] = [];
  let i = 0;
  const blank = (l: string) => l.trim() === '';
  const special = (l: string) => /^(#{1,6}\s|```|>\s?|[-*]\s|\d+\.\s|(-{3,}|\*{3,})\s*$)/.test(l);
  while (i < lines.length) {
    const line = lines[i];
    if (blank(line)) { i++; continue; }
    if (line.startsWith('```')) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) body.push(lines[i++]);
      i++;
      html.push(`<pre><code>${escapeHtml(body.join('\n'))}</code></pre>`);
      continue;
    }
    const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) {
      const level = Math.min(6, Math.max(2, heading[1].length));
      html.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      i++; continue;
    }
    if (/^(-{3,}|\*{3,})\s*$/.test(line)) { html.push('<hr>'); i++; continue; }
    if (/^>\s?/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) body.push(lines[i++].replace(/^>\s?/, ''));
      html.push(`<blockquote>${renderMarkdown(body.join('\n'))}</blockquote>`);
      continue;
    }
    const list = /^([-*]|\d+\.)\s+/.exec(line);
    if (list) {
      const ordered = /\d/.test(list[1]);
      const items: string[] = [];
      const marker = ordered ? /^\d+\.\s+/ : /^[-*]\s+/;
      while (i < lines.length && marker.test(lines[i])) items.push(`<li>${renderInline(lines[i++].replace(marker, ''))}</li>`);
      html.push(`<${ordered ? 'ol' : 'ul'}>${items.join('')}</${ordered ? 'ol' : 'ul'}>`);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && !blank(lines[i]) && (para.length === 0 || !special(lines[i]))) para.push(lines[i++].trim());
    html.push(`<p>${renderInline(para.join(' '))}</p>`);
  }
  return html.join('\n');
}
