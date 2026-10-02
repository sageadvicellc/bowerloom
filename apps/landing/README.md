# Trellis alpha workshop

A standalone React landing page with the selected generated still and a preserved React Three Fiber workshop. It introduces Trellis and the Labs recipe; it does not run the recipe or connect accounts.

From this directory, with Node 24.11:

```sh
npm ci --workspaces=false
npm run dev --workspaces=false
npm run typecheck --workspaces=false
npm run build --workspaces=false
npm run preview --workspaces=false
```

Keep this app's lockfile separate from the monorepo root lockfile. No deployment is configured.

## Interaction and fallback checks

The scene-specific checks below apply to the historical workshop at `/?cinematic=0`. The default static experience and pending video contract are documented further below.

- “Build with your agent” navigates to the setup section.
- Every recipe stage has a keyboard-operable DOM button; stage changes update the explanation and selected scene station.
- Copy the prompt and compare it with the read-only text. If clipboard permissions are unavailable, the text is selected for manual copy.
- The static-map control removes the WebGL canvas. Pause stops the render loop. An offscreen or hidden page suspends animation.
- Reduced motion uses the SVG workshop map without loading the WebGL scene. WebGL construction errors and context loss also fall back to that map.
- Verify layout at 1440 px and 390 px; all navigation, stage, motion, and copy controls have visible keyboard focus.

The historical R3F scene uses procedural geometry, one 1024px shadow map, no textures, no external assets, no postprocessing, and a DPR capped at 1.5. DOM content is independent of the scene.

## Local rendering budget

In the development server, open `/?cinematic=0&diagnostics=1`. The visible local panel reads Three renderer statistics and the actual R3F render-loop mode. It skips two priming frames, samples 120 frames, publishes one result, then stops collecting. There is no telemetry, network call, persisted metric, runtime dependency, or production diagnostics panel.

Acceptance budgets: scene JavaScript ≤300 KiB gzip, tested canvas backing area ≤2 million pixels, DPR ≤1.5, maximum main-render draw calls ≤250, and maximum main-render triangles ≤50,000. Shadow-pass cost and full GPU profiling are unmeasured; the counters do not represent total frame cost. Pause uses demand rendering; static/reduced-motion modes remove the canvas. Frame intervals are supplemental local observations, not a universal FPS promise. See `VERIFICATION.md` for the measured viewport and results.

## Projection UI provenance

`src/projection-tokens.css` is the actual MIT-licensed fallback token stylesheet from `@hannasage/projection-ui` 0.1.5. Its copyright and license are preserved in `PROJECTION-UI-LICENSE`. The compact radius overrides and variable usage follow the consumer mapping in the resume project's `app/lib/apply-visual-palette.ts`. The app consumes the licensed tokens directly; it does not bundle the library's charts or drag-and-drop peers.

Documentation links target `feature/trellis-v1` while alpha work is under review. Reconcile these links with the accepted release branch before a public launch.

## Selected cinematic direction (interim still)

The default page uses the founder-selected Sage Picnic palette: cream, sage, and blush as exact Projection UI token overrides. Its copy surface is opaque cream. Fonts, spacing, radii, and licensed token attribution remain intact. The previous R3F workshop remains available at `/?cinematic=0`. `/?cinematic=1` explicitly selects the new view too.

`src/cinematic-config.ts` is the six-scene media manifest. Supply `/scroll-world/scene-01.webp` through `scene-06.webp` as actual first-frame posters and the corresponding `.mp4` files. The opening poster is the fallback for a scene whose own poster is pending. Its current URL includes the revision `?v=sage-picnic-1` to avoid reusing the replaced dark poster from browser cache. Update this revision when the opening artwork changes. Set each `posterReady` or `clipReady` flag only after matching media for the selected artwork is present. These flags indicate availability, not creative approval or recipe proof. The selected opening still is present. All six clips are marked pending: the earlier dark clip does not match the selected artwork and is not fetched. While matching media is pending, the page uses a short static hero rather than a six-scene empty scroll.

Clips: silent H.264, yuv420p, native landscape 1920×1080, faststart, short GOP (8 recommended), approximately ten seconds, at most fifteen seconds and 16 MiB each. Actual metadata determines seek duration when matching clips are supplied. Only the active clip is fetched into a blob; changing scenes aborts the fetch and revokes its object URL. Content type, byte count, and duration are checked before use. No autoplay, audio playback, external telemetry, or new runtime dependency.

Scroll input is coalesced to the latest target once per animation frame. No new seek starts while the decoder is seeking. The poster remains until a presented video frame is reported, or a completed seek confirms decoded video data and a subsequent animation frame is reached. The latter is a bounded fallback for browsers that defer frame callbacks on paused or occluded video; loading alone never reveals the video. Hidden/offscreen sections stop scheduling seeks. Still-view selection removes the video and cancels its fetch. Mobile/coarse-pointer and reduced-motion modes use the uncropped landscape still with normal-flow copy and do not fetch video.

The illustrative journey is separate from the real recipe below it. All six story beats are also available in the keyboard-operable “Read the journey” disclosure. The primary CTA always opens the setup section.

Run the pure seek-controller checks with Node 24: `node --test test/cinematic-scrub.test.mjs`. The adaptation follows the installed scroll-world 0.8.0 scrub-engine principles, under the MIT license in `SCROLL-WORLD-LICENSE`. Production deployment, six-clip seam inspection, and cross-browser media review remain separate acceptance steps. The current default swap accepts the reviewed static experience only; it does not mark the generated video journey complete.
