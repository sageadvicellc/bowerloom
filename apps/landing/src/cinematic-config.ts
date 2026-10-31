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
      label: "A person reviews a plan in a forest workshop.",
      poster: "/animation-review/assets/motion-poster.webp",
      clip: "/animation-review/robots-lab.mp4",
      durationSeconds: 8.04,
      posterReady: true,
      clipReady: true,
    },
  ],
};

/** Brand coverage-01 ranges. Six page regions share one unchanged clip. */
export const fullpageRegions = [
  {
    "id": "hero",
    "selector": ".hero",
    "start": 0,
    "end": 0.9,
    "poster": "/fullpage-coverage/hero.jpg"
  },
  {
    "id": "portable-teams",
    "selector": "#what-it-does",
    "start": 0.9,
    "end": 2.6,
    "poster": "/fullpage-coverage/portable-teams.jpg"
  },
  {
    "id": "labs",
    "selector": "#how-it-works",
    "start": 2.6,
    "end": 4.5,
    "poster": "/fullpage-coverage/labs.jpg"
  },
  {
    "id": "build",
    "selector": "#install",
    "start": 4.5,
    "end": 6.4,
    "poster": "/fullpage-coverage/build.jpg"
  },
  {
    "id": "questions",
    "selector": "#faq",
    "start": 6.4,
    "end": 7.5,
    "poster": "/fullpage-coverage/questions.jpg"
  },
  {
    "id": "footer",
    "selector": ".site-footer",
    "start": 7.5,
    "end": 8,
    "poster": "/fullpage-coverage/footer.jpg"
  }
] as const;

/** Exact four-second frame from the approved clip, reused as the splash resting image. */
export const splashRestingFrame = {
  poster: '/fullpage-coverage/labs.jpg',
  seconds: 4,
  sha256: 'dd0d210520c64fefa41c93f5ed6d01abe96daa017fd2bad8b7f3139b7ef1effb',
};
