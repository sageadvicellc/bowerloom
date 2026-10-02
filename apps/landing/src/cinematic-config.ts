import { hero, stages } from "./content";

/** Media is supplied and reviewed separately. Ready means matching media is present, not accepted. */
export const cinematicJourney = {
  scrollPerScene: 1.4,
  maxClipBytes: 16 * 1024 * 1024,
  maxClipSeconds: 15,
  openingPoster: "/scroll-world/scene-01.webp?v=sage-picnic-1",
  scenes: [
    { id: "scene-01", label: "Bridge into the craft workshop", title: hero.H1, body: hero.Body, poster: "/scroll-world/scene-01.webp?v=sage-picnic-1", clip: "/scroll-world/scene-01.mp4", posterReady: true, clipReady: true },
    { id: "scene-02", label: "Maker and helper prepare a plan", title: stages[0].title, body: stages[0].description, poster: "/scroll-world/scene-02.webp", clip: "/scroll-world/scene-02.mp4", posterReady: true, clipReady: true },
    { id: "scene-03", label: "Connected worktables and small robot helpers", title: stages[1].title, body: stages[1].description, poster: "/scroll-world/scene-03.webp", clip: "/scroll-world/scene-03.mp4", posterReady: true, clipReady: true },
    { id: "scene-04", label: "Glass archive and glowing connections", title: stages[2].title, body: stages[2].description, poster: "/scroll-world/scene-04.webp", clip: "/scroll-world/scene-04.mp4", posterReady: true, clipReady: true },
    { id: "scene-05", label: "Review desk beside the open workshop", title: stages[3].title, body: stages[3].description, poster: "/scroll-world/scene-05.webp", clip: "/scroll-world/scene-05.mp4", posterReady: true, clipReady: true },
    { id: "scene-06", label: "Open balcony across the connected forest", title: "Build with your agent", body: "Choose a small local task with your personal agent. Review the plan, then create a one-page report.", poster: "/scroll-world/scene-06.webp", clip: "/scroll-world/scene-06.mp4", posterReady: true, clipReady: true },
  ],
};
