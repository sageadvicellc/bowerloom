/** Media is supplied and reviewed separately. Ready means matching media is present, not accepted. */
export const cinematicJourney = {
  scrollPerScene: 1.4,
  maxClipBytes: 16 * 1024 * 1024,
  maxClipSeconds: 15,
  openingPoster: "/scroll-world/scene-01.webp?v=sage-picnic-1",
  scenes: [
    { id: "scene-01", label: "Bridge into the craft workshop", title: "Grow your agent crew on Trellis", body: "A free, open-source toolkit for your personal agent to build connected workflows.", poster: "/scroll-world/scene-01.webp?v=sage-picnic-1", clip: "/scroll-world/scene-01.mp4", posterReady: true, clipReady: false },
    { id: "scene-02", label: "Maker and helper prepare a plan", title: "Start with your own agent.", body: "Describe the routine and what a useful result looks like.", poster: "/scroll-world/scene-02.webp", clip: "/scroll-world/scene-02.mp4", posterReady: false, clipReady: false },
    { id: "scene-03", label: "Connected worktables and small robot helpers", title: "Give each helper a clear job.", body: "Bring skills, roles, and templates together around the work.", poster: "/scroll-world/scene-03.webp", clip: "/scroll-world/scene-03.mp4", posterReady: false, clipReady: false },
    { id: "scene-04", label: "Glass archive and glowing connections", title: "Keep context and a record of the work.", body: "Keep instructions and evidence in files you can inspect and version.", poster: "/scroll-world/scene-04.webp", clip: "/scroll-world/scene-04.mp4", posterReady: false, clipReady: false },
    { id: "scene-05", label: "Review desk beside the open workshop", title: "Review the next step before it runs.", body: "Define the boundaries and review the proposed external action.", poster: "/scroll-world/scene-05.webp", clip: "/scroll-world/scene-05.mp4", posterReady: false, clipReady: false },
    { id: "scene-06", label: "Open balcony across the connected forest", title: "Build with your agent", body: "Start with a small example and a reviewable result.", poster: "/scroll-world/scene-06.webp", clip: "/scroll-world/scene-06.mp4", posterReady: false, clipReady: false },
  ],
};
