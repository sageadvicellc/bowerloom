/**
 * A tiny element builder. Text is always set as text (never as HTML), and only a short list of attributes is allowed,
 * so nothing read from a file can become markup or script.
 */
type Child = Node | string | null | undefined | false;
export interface Props { class?: string; text?: string; type?: string; role?: string; href?: string; id?: string; title?: string; open?: boolean; disabled?: boolean; tabindex?: number; on?: { click?: () => void; change?: (checked: boolean) => void }; checked?: boolean; aria?: Record<string, string> }
const SAFE_ATTR = new Set(['class', 'type', 'role', 'id', 'title']);

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined) continue;
    if (key === 'text') el.textContent = String(value);
    else if (key === 'on') { const on = value as NonNullable<Props['on']>; if (on.click) el.addEventListener('click', () => on.click!()); if (on.change) el.addEventListener('change', () => on.change!((el as unknown as HTMLInputElement).checked)); }
    else if (key === 'checked') { (el as unknown as HTMLInputElement).checked = value === true; }
    else if (key === 'aria') for (const [k, v] of Object.entries(value as Record<string, string>)) el.setAttribute(`aria-${k}`, v);
    else if (key === 'open') { if (value) el.setAttribute('open', ''); }
    else if (key === 'disabled') { if (value) el.setAttribute('disabled', ''); }
    else if (key === 'tabindex') el.setAttribute('tabindex', String(value));
    else if (SAFE_ATTR.has(key)) el.setAttribute(key, String(value));
  }
  for (const child of children) if (child !== null && child !== undefined && child !== false) el.append(typeof child === 'string' ? document.createTextNode(child) : child);
  return el;
}

const SVG = 'http://www.w3.org/2000/svg';
export function icon(paths: readonly string[], size = 22): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  for (const [k, v] of Object.entries({ width: String(size), height: String(size), viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(k, v);
  for (const d of paths) { const p = document.createElementNS(SVG, 'path'); p.setAttribute('d', d); svg.append(p); }
  return svg;
}

/** The icon set, drawn here: simple outlines. No emoji, no outside library. */
export const ICONS = {
  home: ['M3 11.5 12 4l9 7.5', 'M5.5 10v9.5h13V10', 'M10 19.5v-5h4v5'],
  library: ['M5 4h4v16H5z', 'M11 4h4v16h-4z', 'M17.2 5.2l3.4 14.4-3.7.9-3.4-14.4z'],
  projects: ['M3.5 7.5a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z'],
  folders: ['M4 5h16v14H4z', 'M8 9h8', 'M8 13h8', 'M8 16.5h5'],
  storage: ['M4 7c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3z', 'M4 7v5c0 1.7 3.6 3 8 3s8-1.3 8-3V7', 'M4 12v5c0 1.7 3.6 3 8 3s8-1.3 8-3v-5'],
  settings: ['M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z', 'M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z'],
  leaf: ['M5 19c0-8 5-13 14-14 0 9-5 14-13 14', 'M5 19c3-5 6-8 10-10'],
  warning: ['M12 4l9 16H3z', 'M12 10v4', 'M12 17.2v.1'],
  check: ['M5 12.5l4.5 4.5L19 7.5'],
  empty: ['M4 8l8-4 8 4-8 4z', 'M4 8v8l8 4 8-4V8', 'M12 12v8'],
} as const;
