/** React-independent adaptation of scroll-world's latest-target seek coalescing. */
export type ScrubVideo = { currentTime: number; duration: number; seeking: boolean; readyState: number };
export type FrameScheduler = { request: (callback: () => void) => number; cancel: (id: number) => void };

export function createVideoScrubber(video: ScrubVideo, frames: FrameScheduler) {
  let target = 0;
  let pending: number | null = null;
  let enabled = true;
  let disposed = false;

  function schedule() {
    if (!disposed && enabled && pending === null) pending = frames.request(flush);
  }
  function flush() {
    pending = null;
    if (disposed || !enabled || video.seeking || video.readyState < 2 || !Number.isFinite(video.duration) || video.duration <= 0) return;
    // Keep the target off the decoder's end-of-stream boundary.
    const time = target * Math.max(0, video.duration - 1 / 30);
    if (Math.abs(video.currentTime - time) > 1 / 30) {
      try { video.currentTime = time; } catch { /* decoded() retries after readiness. */ }
    }
  }
  return {
    setProgress(progress: number) {
      target = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;
      schedule();
    },
    // Call after seeked/loadeddata. No RAF loop runs while waiting for a decoder.
    decoded: schedule,
    setEnabled(value: boolean) {
      enabled = value;
      if (!enabled && pending !== null) { frames.cancel(pending); pending = null; }
      if (enabled) schedule();
    },
    dispose() {
      disposed = true;
      if (pending !== null) frames.cancel(pending);
      pending = null;
    },
  };
}
