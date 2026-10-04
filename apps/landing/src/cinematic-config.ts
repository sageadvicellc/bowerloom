import { hero, stages } from "./content.ts";

/** Historical six-scene study. Kept as an unmounted reference; not the beta preview. */
export const historicalCinematicJourney = {
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
    { id: "scene-06", label: "Open balcony across the connected forest", title: "Build with your agent", body: "Give your personal agent a goal. Define a small team, agree on the work, and review the result at milestones.", poster: "/scroll-world/scene-06.webp", clip: "/scroll-world/scene-06.mp4", posterReady: true, clipReady: true },
  ],
};

/** Founder-approved lab-robots-03, reused byte-for-byte. This is one scene, not the full journey. */
export const cinematicJourney = {
  scrollPerScene: 1.4,
  maxClipBytes: 16 * 1024 * 1024,
  maxClipSeconds: 8.1,
  openingPoster: "/animation-review/assets/motion-poster.webp",
  illustrationNote: "This illustrated preview represents an intended workflow. It does not establish software behavior, benchmark results, or a winning model.",
  approvalNote: "Review the exact plan. Approve only the actions you choose.",
  scenes: [
    {
      id: "lab-robots-03",
      label: "Hanna reviews a plan in a forest lab.",
      poster: "/animation-review/assets/motion-poster.webp",
      clip: "/animation-review/robots-lab.mp4",
      durationSeconds: 8.04,
      posterReady: true,
      clipReady: true,
    },
  ],
};
