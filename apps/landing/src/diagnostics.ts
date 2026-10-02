/** Local development budgets; no metrics leave the browser. */
export const renderingBudget = {
  sceneGzipKiB: 300,
  backingPixels: 2_000_000,
  dpr: 1.5,
  drawCalls: 250,
  triangles: 50_000,
  sampleFrames: 120,
} as const;

export type RenderSample = {
  frames: number;
  calls: number;
  triangles: number;
  dpr: number;
  backingWidth: number;
  backingHeight: number;
  meanFrameMs: number;
  p95FrameMs: number;
};
