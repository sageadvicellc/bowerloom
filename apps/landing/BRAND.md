# Alpha identity integration

The wordmark uses ordinary letters throughout. The ink and cream SVG files are the exact round-07 plain exports from the brand team. They reuse the existing ordinary o in place of the superseded yarn glyph. These raster-backed SVGs retain the 2044:374 aspect ratio. They are not path-based vector masters. The S4-G3 bot icon remains part of the identity.

The S4-G3 icons are the exact round-05 approved light and dark exports. Dark mode uses the version with light foliage ears. The icon also supplies the favicon. Earlier assets remain preserved.

Rose Conservatory is the light palette; After Hours is the dark palette. `src/brand.css` contains the exact approved colors and maps them onto the existing Projection UI token and control structure. Newsreader supplies headings and emphasized product names, Manrope supplies reading copy and interface labels, and code retains a monospace stack at a minimum of 14px. Font files and their OFL licenses are local.

The header theme icon button defaults to the operating system preference. Each press cycles Light (day), Dark (night), System (day and night), then Light. Its icon shows the selected preference and its accessible label names both the current state and next action. Light and Dark are explicit overrides. A saved choice is local to the browser, using only the `bowerloom.theme` key. If storage is unavailable, the control still works for the current page. System preference changes affect the page only while System is selected. The native color scheme, browser theme color and favicon follow the resolved preference. The footer always uses After Hours, the cream plain wordmark, and the dark-friendly S4-G3 icon. Its contrast does not change with the page theme.

This identity change does not alter tutorial choices, startup commands, content, motion admission, media assets, or the private forest pilot. Character sheets and internal brand handoff paths are not deployed. It does not authorize future scene generation.

Verification includes exact image hashes, theme resolution and storage-failure cases, native surface updates, font-license presence, palette constants, and the existing landing tests. Browser review must still assess final wordmark detail, keyboard interaction, responsive overflow and both themes at real sizes.
