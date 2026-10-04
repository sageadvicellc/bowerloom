export type SplashState = 'loading' | 'playing' | 'paused' | 'blocked' | 'ended' | 'error';
export const SPLASH_SESSION_KEY = 'bowerloom-splash-lab03-v1';
export function shouldShowSplash(hash: string, storage: Pick<Storage, 'getItem'> | null) {
  if (hash.length > 1) return false;
  try { return storage?.getItem(SPLASH_SESSION_KEY) !== 'seen'; } catch { return true; }
}
export function rememberSplash(storage: Pick<Storage, 'setItem'> | null) {
  try { storage?.setItem(SPLASH_SESSION_KEY, 'seen'); } catch { /* A blocked storage area does not block entry. */ }
}
type Media = Pick<HTMLVideoElement, 'play' | 'pause' | 'paused' | 'ended' | 'addEventListener' | 'removeEventListener'>;
type Visibility = Pick<Document, 'hidden' | 'addEventListener' | 'removeEventListener'>;
export function createSplashPlayback(video: Media, visibility: Visibility, state: (value: SplashState) => void) {
  let disposed = false, resume = false, wantsPlayback = false, request = 0;
  const play = async () => {
    if (disposed || visibility.hidden) return;
    wantsPlayback = true;
    const current = ++request;
    try {
      await video.play();
      if (disposed || visibility.hidden || !wantsPlayback) { video.pause(); return; }
      if (current === request) state('playing');
    } catch { if (!disposed && current === request) { wantsPlayback = false; state('blocked'); } }
  };
  const pause = () => { request++; resume = false; wantsPlayback = false; video.pause(); if (!disposed) state('paused'); };
  const change = () => {
    if (visibility.hidden) { resume = !video.paused && !video.ended; request++; wantsPlayback = false; video.pause(); }
    else if (resume) { resume = false; void play(); }
  };
  const ended = () => { resume = false; wantsPlayback = false; state('ended'); };
  const error = () => { request++; resume = false; wantsPlayback = false; video.pause(); state('error'); };
  video.addEventListener('ended', ended);
  video.addEventListener('error', error);
  visibility.addEventListener('visibilitychange', change);
  return { play, pause, dispose() {
    disposed = true; request++; resume = false; wantsPlayback = false; video.pause();
    video.removeEventListener('ended', ended); video.removeEventListener('error', error);
    visibility.removeEventListener('visibilitychange', change);
  } };
}

export function splashVideoAllowed(reducedMotion: boolean, requested: boolean, failed: boolean) {
  return (!reducedMotion || requested) && !failed;
}
