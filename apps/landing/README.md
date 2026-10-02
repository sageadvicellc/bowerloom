# Trellis alpha workshop

A standalone React / React Three Fiber landing page. It introduces Trellis and the Labs recipe; it does not run the recipe or connect accounts.

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

- “Build with your agent” navigates to the setup section.
- Every recipe stage has a keyboard-operable DOM button; stage changes update the explanation and selected scene station.
- Copy the prompt and compare it with the read-only text. If clipboard permissions are unavailable, the text is selected for manual copy.
- The static-map control removes the WebGL canvas. Pause stops the render loop. An offscreen or hidden page suspends animation.
- Reduced motion uses the SVG workshop map without loading the WebGL scene. WebGL construction errors and context loss also fall back to that map.
- Verify layout at 1440 px and 390 px; all navigation, stage, motion, and copy controls have visible keyboard focus.

The scene uses procedural geometry, one 1024px shadow map, no textures, no external assets, no postprocessing, and a DPR capped at 1.5. DOM content is independent of the scene.

## Local rendering budget

In the development server, open `/?diagnostics=1`. The visible local panel reads Three renderer statistics and the actual R3F render-loop mode. It skips two priming frames, samples 120 frames, publishes one result, then stops collecting. There is no telemetry, network call, persisted metric, runtime dependency, or production diagnostics panel.

Acceptance budgets: scene JavaScript ≤300 KiB gzip, tested canvas backing area ≤2 million pixels, DPR ≤1.5, maximum main-render draw calls ≤250, and maximum main-render triangles ≤50,000. Shadow-pass cost and full GPU profiling are unmeasured; the counters do not represent total frame cost. Pause uses demand rendering; static/reduced-motion modes remove the canvas. Frame intervals are supplemental local observations, not a universal FPS promise. See `VERIFICATION.md` for the measured viewport and results.

## Projection UI provenance

`src/projection-tokens.css` is the actual MIT-licensed fallback token stylesheet from `@hannasage/projection-ui` 0.1.5. Its copyright and license are preserved in `PROJECTION-UI-LICENSE`. The compact radius overrides and variable usage follow the consumer mapping in the resume project's `app/lib/apply-visual-palette.ts`. The app consumes the licensed tokens directly; it does not bundle the library's charts or drag-and-drop peers.

Documentation links target `feature/trellis-v1` while alpha work is under review. Reconcile these links with the accepted release branch before a public launch.
