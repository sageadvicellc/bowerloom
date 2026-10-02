# Landing verification — October 2, 2026

This is a local preview, not a public deployment or release.

## Passed

- Standalone dependency installation with its own package-lock; root lockfile unchanged.
- TypeScript check and Vite production build.
- Desktop visual inspection in the Codex in-app browser at its default 1272 × 716 viewport.
- Mobile visual inspection at 390 × 844. No horizontal document overflow (390 viewport, 382 document content width).
- Main CTA navigates to the real setup section on desktop and mobile.
- Clipboard success feedback appears after copying the setup prompt.
- Evidence selection updates the stage explanation and selected state.
- Review activates with Enter; Draft activates with Space, with the corresponding explanation and pressed state.
- Pause changes to Resume with pressed state; rendering uses demand mode while paused.
- Static-map selection removes the canvas (zero canvas elements) and renders the accessible SVG map.
- Browser console contained no application errors.
- Disk guard passed before installation/build, preserving the 12 GiB reserve. Installation occupies 126 MiB; production output roughly 1.1 MiB.

## Implementation limits

- Reduced-motion preference, initial WebGL construction failure, and context-loss handlers use the same map component verified through the explicit static-map control. OS reduced-motion emulation and forced GPU context loss were not exercised through the available browser UI.
- Clipboard permission denial has a focus/select fallback, but denial was not forced.
- Hidden/offscreen suspension is implemented with visibilitychange and IntersectionObserver. A bounded renderer-statistics sample is recorded below; full CPU/GPU profiling was not recorded.
- The 3D chunk is lazy-loaded and about 240 KiB gzip. Vite reports its 700 KiB raw chunk warning. The reduced-motion path does not load this chunk.
- React Three Fiber's internal use of Three.Clock produces an upstream deprecation warning with Three 0.183.2. Explicit percentage shadows avoid the deprecated soft shadow mode.
- Documentation URLs target the active integration branch. The recipe docs and skill are supplied by the parallel recipe work before integration. Public branch/release URLs require reconciliation before launch.
- No recipe execution, account connection, publishing, merge, paid service, or deployment occurs from this page.

## Evidence

### Measured rendering budget

Local Chrome, viewport 1280 × 720, October 2. The visible development-only `?diagnostics=1` panel skipped two priming frames and sampled 120 frames. Sampling then stopped. Renderer statistics describe the preceding completed main render. Three 0.183.2 resets these counters after the shadow pass, so shadow-pass cost is not included. Shadow cost and full GPU profiling remain unmeasured; these counters do not represent total frame cost. No metric is transmitted or persisted by the application.

| Metric | Measured | Budget |
| --- | ---: | ---: |
| Lazy scene JavaScript (gzip) | 231.63 KiB (237,185 bytes) | ≤300 KiB |
| Maximum main-render draw calls | 191 | ≤250 |
| Maximum main-render triangles | 11,380 | ≤50,000 |
| DPR | 1.5 | ≤1.5 |
| Canvas backing dimensions | 1341 × 904 | — |
| Canvas backing pixels | 1,212,264 | ≤2,000,000 |
| Sampled frame interval, mean | 8.33 ms | observation only |
| Sampled frame interval, p95 | 9.30 ms | observation only |

The exact gzip byte count uses Python gzip at level 6 over the production scene chunk; Vite separately reports approximately 240 kB gzip. Production JavaScript was checked for the diagnostics panel and sampling text, which are absent.

All bounded metrics passed in this viewport. Timing is specific to this local run and does not establish performance across devices. The loop reported `always` while animated and `demand` after Pause, read from actual R3F state. Static-map mode reported zero canvas elements. Reduced motion shares that same canvas-free branch; OS preference emulation remains untested.

Screenshots: `rendering-budget.jpg`, `rendering-paused.jpg`, and `rendering-static.jpg` in the campaign evidence directory below.

Local preview: http://127.0.0.1:4174/

Browser screenshots are recorded outside the source tree in the campaign evidence directory:

- work/campaign/alpha/landing/desktop-workshop.jpg
- work/campaign/alpha/landing/desktop-recipe-keyboard.jpg
- work/campaign/alpha/landing/mobile-map.jpg
- work/campaign/alpha/landing/mobile-setup.jpg

The lead independently reviews the artifact before integration.

## Historical cinematic pilot — implementation check, 2026-10-02

The pilot is gated by `?cinematic=1`; the default scene and slogan are preserved. Canopy Brass overrides Projection tokens only for this route. Scene one uses the supplied actual first-frame poster and silent 1080p MP4. Other scene flags remain pending. The media files are authored and committed separately by the campaign lead.

- Node 24 seek-controller suite: 4/4 passed (latest-target coalescing, decoder-in-flight handling, pause/resume/disposal, finite metadata and bounded endpoint).
- TypeScript check and production build passed. The first build measured main JS 76.85 kB gzip and the unchanged lazy Workshop chunk 240.00 kB gzip. These sizes exclude video media.
- Disk guard before build: 37.06 GiB free, 12 GiB reserve, 0.25 GiB expected growth allowed.
- Chrome at 1440×900 and 1440×1000: semantic hero and primary CTA present; actual poster decoded at 1920px width; no horizontal overflow. PageDown moved scene-one currentTime to approximately 6.03 seconds of 10.041667; paused=true, muted=true, autoplay=false. Query route has zero canvases.
- Entering pending scene two removed the video and explicitly reported the opening still as its fallback. Selecting still view removed the video and canvas and reported paused scroll animation.
- Designer independently reviewed opening mobile and 1440×900 desktop composition and reported no runtime visual findings in those static views.
- Frame reveal initially rejected a confirmed callback when a later seek reduced readyState. The final implementation trusts the confirmed frame and retains a completed-seek fallback after an animation frame. Final browser recheck is pending because the Chrome QA tab disappeared and new-tab creation became unavailable. The saved desktop screenshot predates this final correction and is not proof of accepted animation.

Not accepted yet: final frame-reveal browser recheck, mobile no-video-network evidence, OS reduced-motion emulation, forced network/decode failure, visibility suspension in a real tab, Safari/Firefox behavior, all six clips and their seams, creative review, or a default-route switch. No deployment or publication was performed.

## Sage Picnic — reviewed interim static default, 2026-10-02

This section supersedes the prior Canopy Brass direction and query-only default. The founder selected Sage Picnic. Its exact color tokens are applied as Projection overrides; typography, spacing, corner geometry, and vendor license remain. Copy and status surfaces are opaque cream. The root-owned poster is the selected 1672×941 Sage Picnic artwork, loaded with a revision query to prevent reuse of the old cached dark poster.

- Chrome desktop 1440×900: selected artwork loaded; maker and robot remain visible; copy background measured rgb(255,248,237); no horizontal overflow; static hero height900px; zero videos and canvases.
- Chrome mobile 390×844: uncropped image uses object-fit contain; exact slogan and primary CTA fit; no horizontal overflow; zero videos and canvases.
- Default `/` renders this static experience. `/?cinematic=0` renders the preserved original hero, clears the new theme, and restores its #07090C background. `/?cinematic=1` also selects the new direction.
- “Read the journey” opens six semantic story items and closes with Enter. The primary CTA reaches #build (measured top20px after navigation) with the read-only prompt visible.
- Footer now links to package.json as “License declaration”; it makes no claim that a root MIT license artifact exists.
- All six clipReady flags are false. The old video does not match the selected artwork and is not used. With no matching clips ready, the runtime uses a short still hero, reports animation pending, and does not offer an inactive motion toggle.
- Designer full-page review found a leftover chartreuse inline recipe eyebrow. The cinematic branch now uses --ui-muted for every stage; designer confirmed the source and5.33:1 cream contrast. Its narrow rendered-label recheck is pending after the shared Chrome tab disappeared.
- Typecheck and4/4 seek-controller tests passed. No production build was rerun for this CSS/copy/default change; local Vite rendering was inspected. Browser viewport override was reset.

Proof: campaign/alpha/landing/sage-picnic-desktop.jpg, sage-picnic-mobile.jpg, and sage-picnic-mobile-setup.jpg. The media files and palette comparison are authored separately by the campaign lead and excluded from this runtime commit.

The static default is reviewed; the generated video journey is still incomplete. Matching video, final confirmed-frame reveal recheck, six-clip seams, forced network/decode failure, real hidden-tab suspension, OS reduced-motion emulation, and Safari/Firefox checks remain pending. No deployment or publication was performed.

## Founder mono-size revision — 2026-10-02

- Selected-theme labels/eyebrows/status measured13px; navigation, primary/copy controls measured14px; prompt measured14px with22.4px line height (1.6) and440px height. Copy button measured44px height. Projection mono stack retained.
- Heading/body unchanged: desktop hero63.36px and descriptive body16px at1440×900.
- Chrome1440×900,390×844, and320×740: no document overflow. At320px the header, wrapped prompt header, and footer also report no internal horizontal overflow. Setup navigation still reaches top20px, and the read-only prompt receives keyboard focus.
- The previously pending recipe-eyebrow render repair is now confirmed: rgb(104,104,95), the selected --ui-muted value, at13px.
- Typecheck,4/4 seek-controller tests, and diff whitespace check passed. No production build or media generation was performed for the sizing change.

Proof: campaign/alpha/landing/sage-picnic-mono-desktop.jpg, sage-picnic-mono-mobile.jpg, sage-picnic-mono-small-setup.jpg, and sage-picnic-mono-small-prompt.jpg. Video acceptance limitations from the static-default review remain; the still and larger type do not constitute completed animation proof.

## Founder-selected Lora — 2026-10-02

The runtime now uses the selected audition's unmodified local Lora variable TTF. Its SIL OFL 1.1 copyright/license is preserved alongside it in public/fonts/lora/OFL.txt. SOURCE.json records the original Google Fonts source and SHA-256; source and destination bytes were compared and matched. Font file size: 212,196 bytes. No external font request or new dependency was added.

- Display headings measure Lora, weight 500, with font-optical-sizing auto. Body copy measures Lora, weight 400, at 18px and line height 1.65. All six h1/h2/h3 elements were checked at mobile width.
- Projection mono stack remains on navigation, buttons, utility labels, the brand wordmark, commands, and the read-only setup prompt. Navigation and prompt remain 14px; the brand retains its existing weight 600.
- Chrome at 1440×900, 390×844, and 320×740: no horizontal document overflow. The small mobile header and prompt header also show no internal overflow. Desktop copy fits its panel without internal scrolling; the maker and robot remain visible. The primary CTA reaches setup at top 20.16px on small mobile.
- Typecheck and 4/4 seek-controller tests passed. Runtime CSS/docs pass the whitespace check; the verbatim upstream OFL file intentionally retains one trailing space on line 21. No production build or media generation was performed for this font change.

Proof: campaign/alpha/landing/sage-picnic-lora-desktop.jpg, sage-picnic-lora-mobile.jpg, and sage-picnic-lora-small-setup.jpg. Matching video and the remaining video/browser acceptance checks are still pending; this typography review applies to the current static experience.
