// What `look` shows. Two parts. `collectPage` runs inside the app window and gathers ONLY what a person sees: text, roles, names, states and where
// each control is. It returns plain strings and numbers (never an element, a tag name, a class, an id, a style or any markup). `formatLook` turns that
// into the text a persona reads. The page keeps the controls in a list under a private key, so a number from the look can be clicked later.

/** The key under which the page keeps the controls of the last look. The persona tool and nothing else reads it. */
export const HANDLE_KEY = 'bowerloom.persona.handles';

/**
 * Runs in the page. Must stay self-contained: it is sent to the window as text, so it may use nothing from this file.
 * Returns { width, height, title, dark, reduced, scrollY, scrollMax, focus, layers, truncated, items }.
 */
export function collectPage(options) {
  const maxItems = options.maxItems, maxText = options.maxText;
  const handles = [];
  const items = [];
  let truncated = false;
  const vw = window.innerWidth, vh = window.innerHeight;
  const active = document.activeElement;
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'HEAD', 'META', 'LINK', 'TITLE', 'PATH', 'DEFS', 'USE']);
  const WIDGET_ROLES = new Set(['button', 'link', 'tab', 'checkbox', 'radio', 'switch', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'slider', 'combobox', 'textbox', 'searchbox', 'treeitem', 'spinbutton']);
  const REGION_ROLES = new Set(['dialog', 'alertdialog', 'navigation', 'main', 'complementary', 'banner', 'contentinfo', 'toolbar', 'tablist', 'status', 'alert', 'menu', 'listbox', 'tooltip', 'region', 'group', 'form', 'search']);
  const TAG_REGION = { DIALOG: 'dialog', NAV: 'navigation', MAIN: 'main', ASIDE: 'complementary', FORM: 'form' };
  const HANDLE_SELECTOR = 'button, a[href], input:not([type=hidden]), select, textarea, summary, [role=button], [role=link], [role=tab], [role=checkbox], [role=radio], [role=switch], [role=menuitem], [role=option], [role=slider], [role=combobox], [role=textbox], [tabindex]:not([tabindex="-1"]), [contenteditable=""], [contenteditable="true"], [draggable="true"]';
  const clean = s => String(s).replace(/\s+/g, ' ').trim();
  const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

  function hidden(el, style) {
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return true;
    if (Number(style.opacity) === 0) return true;
    const r = el.getBoundingClientRect();
    return r.width <= 1 && r.height <= 1 && style.overflow !== 'visible' && style.display !== 'contents';
  }

  // The text a person reads inside one element, with the hidden parts left out.
  function textOf(node) {
    if (node.nodeType === 3) return node.data;
    if (node.nodeType !== 1 || SKIP.has(node.tagName.toUpperCase())) return '';
    const style = getComputedStyle(node);
    if (hidden(node, style)) return '';
    if (node.tagName === 'IMG') return node.getAttribute('alt') || '';
    let out = '';
    for (const child of node.childNodes) out += textOf(child);
    const inline = style.display.startsWith('inline') || style.display === 'contents';
    return inline ? out : ` ${out} `;
  }

  function labelsText(el) {
    const ids = el.getAttribute('aria-labelledby');
    if (ids) {
      const t = clean(ids.split(/\s+/).map(id => { const n = document.getElementById(id); return n ? textOf(n) : ''; }).join(' '));
      if (t) return t;
    }
    const own = el.getAttribute('aria-label');
    if (own && clean(own)) return clean(own);
    if (el.labels && el.labels.length > 0) { const t = clean([...el.labels].map(textOf).join(' ')); if (t) return t; }
    return '';
  }

  function roleOf(el) {
    const explicit = (el.getAttribute('role') || '').split(/\s+/)[0];
    if (explicit) return explicit;
    const tag = el.tagName;
    if (tag === 'BUTTON' || tag === 'SUMMARY') return 'button';
    if (tag === 'A') return el.hasAttribute('href') ? 'link' : '';
    if (tag === 'SELECT') return 'combobox';
    if (tag === 'TEXTAREA') return 'textbox';
    if (tag === 'INPUT') {
      const t = (el.getAttribute('type') || 'text').toLowerCase();
      if (t === 'checkbox') return 'checkbox';
      if (t === 'radio') return 'radio';
      if (t === 'range') return 'slider';
      if (t === 'number') return 'spinbutton';
      if (t === 'search') return 'searchbox';
      if (t === 'button' || t === 'submit' || t === 'reset' || t === 'image') return 'button';
      return 'textbox';
    }
    if (/^H[1-6]$/.test(tag)) return 'heading';
    if (tag === 'IMG') return 'image';
    return TAG_REGION[tag] || '';
  }

  function isControl(el, style, role) {
    if (el.matches('input[type=hidden]')) return false;
    // A label is not a control when its field is on the screen: the field is the control. A label whose field is not drawn stands in for it.
    if (el.tagName === 'LABEL' && el.control) return hidden(el.control, getComputedStyle(el.control));
    if (role === 'heading') return false;
    if (WIDGET_ROLES.has(role)) return true;
    if (el.matches(HANDLE_SELECTOR) && !REGION_ROLES.has(role)) return true;
    // A thing that only shows a pointer when the cursor is over it, such as a card that is a link in all but name.
    const parent = el.parentElement;
    return style.cursor === 'pointer' && (!parent || getComputedStyle(parent).cursor !== 'pointer');
  }

  function statesOf(el, role) {
    const s = [];
    const a = n => el.getAttribute(n);
    if (a('aria-pressed') === 'true') s.push('pressed'); else if (a('aria-pressed') === 'mixed') s.push('half pressed');
    if (a('aria-selected') === 'true') s.push('selected');
    if (a('aria-current') && a('aria-current') !== 'false') s.push('current');
    if (a('aria-expanded') === 'true') s.push('expanded'); else if (a('aria-expanded') === 'false') s.push('collapsed');
    const checkable = role === 'checkbox' || role === 'radio' || role === 'switch' || role === 'menuitemcheckbox' || role === 'menuitemradio';
    if (checkable) s.push(el.checked === true || a('aria-checked') === 'true' ? 'checked' : a('aria-checked') === 'mixed' ? 'half checked' : 'not checked');
    if (el.disabled === true || a('aria-disabled') === 'true') s.push('disabled');
    if (el.readOnly === true || a('aria-readonly') === 'true') s.push('read only');
    if (a('aria-invalid') === 'true') s.push('invalid');
    if (a('aria-busy') === 'true') s.push('busy');
    if (a('aria-haspopup') && a('aria-haspopup') !== 'false') s.push('opens a menu or panel');
    if (el === active) s.push('has focus');
    return s;
  }

  let buffer = '';
  const flush = depth => {
    const t = clean(buffer);
    buffer = '';
    if (t !== '') push({ t: 'text', depth, text: clip(t, maxText) });
  };
  function push(item) {
    if (items.length >= maxItems) { truncated = true; return; }
    items.push(item);
  }

  function addControl(el, style, role, depth) {
    const rect = el.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return false;
    let name = '', iconOnly = false;
    const tag = el.tagName;
    const labelled = labelsText(el);
    const visible = clean(textOf(el));
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
      name = labelled || clean(el.getAttribute('placeholder') || '') || clean(el.getAttribute('title') || '');
      if (!labelled && name) iconOnly = true;
    } else if (visible) { name = visible; } else { name = labelled || clean(el.getAttribute('title') || ''); iconOnly = name !== ''; }
    let value = null;
    if (tag === 'INPUT' || tag === 'TEXTAREA') {
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      if (!['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'image'].includes(type)) value = type === 'password' ? '(hidden)' : clip(String(el.value || ''), 80);
    } else if (tag === 'SELECT') {
      value = el.selectedOptions && el.selectedOptions[0] ? clip(clean(el.selectedOptions[0].textContent || ''), 80) : '';
    }
    const placeholder = (tag === 'INPUT' || tag === 'TEXTAREA') && labelled ? clean(el.getAttribute('placeholder') || '') : '';
    const off = rect.bottom <= 0 || rect.top >= vh || rect.right <= 0 || rect.left >= vw;
    if (items.length >= maxItems) { truncated = true; return false; }
    handles.push(el);
    const source = tag === 'LABEL' && el.control ? el.control : el;
    const shown = tag === 'LABEL' && el.control ? roleOf(el.control) : role;
    items.push({ t: 'control', depth, n: handles.length, role: shown || 'clickable', name: clip(name, 120), iconOnly, states: statesOf(source, shown), value, placeholder: clip(placeholder, 60), off });
    return true;
  }

  function walk(node, depth) {
    if (node.nodeType === 3) { buffer += node.data; return; }
    if (node.nodeType !== 1) return;
    const el = node;
    const tag = el.tagName.toUpperCase();
    if (SKIP.has(tag)) return;
    const style = getComputedStyle(el);
    if (hidden(el, style)) return;
    if (tag === 'SVG' || el instanceof SVGElement) {
      const alt = clean(el.getAttribute('aria-label') || '');
      if (alt && el.getAttribute('role') === 'img') { flush(depth); push({ t: 'image', depth, text: clip(alt, 120) }); }
      return;
    }
    if (tag === 'CANVAS') { flush(depth); push({ t: 'image', depth, text: 'a drawing made by the app (its words are not readable)' }); return; }
    if (tag === 'IMG') { flush(depth); const alt = clean(el.getAttribute('alt') || ''); push({ t: 'image', depth, text: alt === '' ? '(no description)' : clip(alt, 120) }); return; }
    const role = roleOf(el);
    const inline = style.display.startsWith('inline');
    const transparent = style.display === 'contents';
    if (!inline && !transparent) flush(depth);
    if (isControl(el, style, role)) {
      flush(depth);
      const nested = el.querySelector(HANDLE_SELECTOR) !== null;
      const made = addControl(el, style, role, depth);
      if (made && !nested) return;
      if (!made) return;
      for (const child of el.childNodes) walk(child, depth);
      flush(depth);
      return;
    }
    if (role === 'heading') {
      if (el.querySelector(HANDLE_SELECTOR) === null) {
        flush(depth);
        const t = clean(textOf(el));
        const level = Number(el.getAttribute('aria-level')) || (/^H([1-6])$/.test(tag) ? Number(tag[1]) : 2);
        if (t !== '') push({ t: 'heading', depth, level, text: clip(t, maxText) });
        return;
      }
    }
    const regionRole = REGION_ROLES.has(role) ? role : '';
    const regionName = regionRole ? clean(labelsText(el) || el.getAttribute('title') || '') : '';
    const isRegion = regionRole && (regionName || !['region', 'group', 'form', 'search'].includes(regionRole));
    if (isRegion) {
      flush(depth);
      push({ t: 'region', depth, role: regionRole, name: clip(regionName, 80), modal: el.getAttribute('aria-modal') === 'true' || tag === 'DIALOG' });
    }
    const childDepth = isRegion ? depth + 1 : depth;
    for (const child of el.childNodes) walk(child, childDepth);
    if (!inline && !transparent) flush(childDepth);
  }

  walk(document.body, 0);
  flush(0);
  window[Symbol.for(options.key)] = handles;

  let focus = null;
  const at = handles.indexOf(active);
  if (at >= 0) focus = { n: at + 1 };
  else if (active && active !== document.body && active !== document.documentElement) {
    const role = roleOf(active) || 'element';
    focus = { n: null, role, name: clip(clean(labelsText(active) || textOf(active)), 80) };
  }
  const scroller = document.scrollingElement || document.documentElement;
  const scrollMax = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  return {
    width: vw, height: vh, title: clip(clean(document.title), 100),
    dark: window.matchMedia('(prefers-color-scheme: dark)').matches,
    reduced: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    scrollY: Math.round(scroller.scrollTop), scrollMax: Math.round(scrollMax),
    focus, truncated, items,
  };
}

const q = s => `"${String(s).replace(/"/g, "'")}"`;
const pad = depth => '  '.repeat(Math.min(depth, 6));

/** One line for one control: [7] button "Add" (pressed, off screen). */
export function controlLine(item) {
  const bits = [...item.states];
  if (item.off) bits.push('out of view');
  if (item.iconOnly) bits.push('shows an icon only, no visible words');
  let line = `[${item.n}] ${item.role}${item.name === '' ? ' (no name)' : ` ${q(item.name)}`}`;
  if (item.value !== null && item.value !== undefined) line += ` value=${q(item.value)}`;
  if (item.placeholder) line += ` hint=${q(item.placeholder)}`;
  if (bits.length > 0) line += ` (${bits.join(', ')})`;
  return line;
}

/**
 * Turns what the page returned into the text of a look. It writes ONLY these fields of each item: kind, depth, text, role, name, states, value, hint.
 * Any other field of the input is ignored, so nothing else can leak into a look.
 */
export function formatLook(raw, { shot = null, redactor = text => text } = {}) {
  const lines = [];
  lines.push(`WINDOW: ${raw.width} by ${raw.height}, ${raw.dark ? 'dark' : 'light'} colours, ${raw.reduced ? 'reduced' : 'normal'} motion`);
  if (raw.title) lines.push(`TITLE: ${raw.title}`);
  const f = raw.focus;
  const focused = f !== null && f !== undefined && f.n !== null && f.n !== undefined ? raw.items.find(i => i.t === 'control' && i.n === f.n) : undefined;
  lines.push(`FOCUS: ${f === null || f === undefined ? 'nothing in particular' : focused !== undefined ? `[${f.n}] ${focused.role}${focused.name ? ` ${q(focused.name)}` : ''}` : f.n !== null && f.n !== undefined ? `control [${f.n}]` : `${f.role}${f.name ? ` ${q(f.name)}` : ''} (not numbered)`}`);
  const layers = raw.items.filter(i => i.t === 'region' && (i.role === 'dialog' || i.role === 'alertdialog'));
  lines.push(`OPEN LAYERS: ${layers.length === 0 ? 'none' : layers.map(l => `${l.role}${l.name ? ` ${q(l.name)}` : ''}`).join(', ')}`);
  const tour = layers.some(l => /tour/i.test(l.name));
  lines.push(`TOUR: ${tour ? 'open' : 'not open'}`);
  const selected = raw.items.filter(i => i.t === 'control' && i.states.some(s => s === 'pressed' || s === 'selected' || s === 'expanded' || s === 'current' || s === 'checked'));
  lines.push(`ON: ${selected.length === 0 ? 'nothing is selected, pressed or expanded' : selected.map(i => `[${i.n}] ${i.name ? q(i.name) : i.role} (${i.states.filter(s => ['pressed', 'selected', 'expanded', 'current', 'checked'].includes(s)).join(', ')})`).join('; ')}`);
  lines.push(`SCROLL: ${raw.scrollMax <= 0 ? 'the window does not scroll' : `${raw.scrollY <= 0 ? 'at the top' : raw.scrollY >= raw.scrollMax ? 'at the bottom' : `${Math.round((raw.scrollY / raw.scrollMax) * 100)} percent down`}`}`);
  lines.push('---');
  for (const item of raw.items) {
    const p = pad(item.depth);
    if (item.t === 'text') lines.push(`${p}${item.text}`);
    else if (item.t === 'heading') lines.push(`${p}heading ${item.level}: ${item.text}`);
    else if (item.t === 'image') lines.push(`${p}image: ${item.text}`);
    else if (item.t === 'region') lines.push(`${p}${item.role}${item.name ? ` ${q(item.name)}` : ''}:`);
    else if (item.t === 'control') lines.push(`${p}${controlLine(item)}`);
  }
  if (raw.truncated) lines.push('(There is more on the screen than this list holds. Scroll and look again.)');
  lines.push('---');
  const count = raw.items.filter(i => i.t === 'control').length;
  lines.push(`${count} numbered ${count === 1 ? 'control' : 'controls'}. The numbers work until the screen changes or you look again.`);
  const body = redactor(lines.join('\n'));
  return shot === null ? body : `${body}\nSCREENSHOT: ${shot}`;
}
