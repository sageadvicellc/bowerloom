import type { IntroMedia } from './intro-media.ts';
export type IntroStatus = 'loading' | 'playing' | 'paused' | 'blocked';
export type IntroFrame = { time: number; phase: 'film' | 'logo' | 'reveal'; logo: number; reveal: number };
export type IntroExit = 'complete' | 'skip' | 'failure' | 'timeout' | 'reduced-motion';
type Media = Pick<HTMLVideoElement, 'currentTime' | 'duration' | 'videoWidth' | 'videoHeight' | 'readyState' | 'paused' | 'ended' | 'muted' | 'volume' | 'play' | 'pause' | 'addEventListener' | 'removeEventListener'>;
type Visibility = Pick<Document, 'hidden' | 'addEventListener' | 'removeEventListener'>;
export type IntroClock = { now: () => number; request: (callback: () => void) => number; cancel: (id: number) => void; after: (callback: () => void, ms: number) => number; clear: (id: number) => void };
const owners = new WeakMap<object, symbol>();
const clamp = (value: number) => Math.max(0, Math.min(1, value));
export function introFrame(time: number, media: Pick<IntroMedia, 'duration' | 'logoAt' | 'revealAt'>): IntroFrame {
  const bounded = Math.max(0, Math.min(media.duration, Number.isFinite(time) ? time : 0));
  return { time: bounded, phase: bounded >= media.revealAt ? 'reveal' : bounded >= media.logoAt ? 'logo' : 'film',
    logo: clamp((bounded - media.logoAt) / .8), reveal: clamp((bounded - media.revealAt) / (media.duration - media.revealAt)) };
}
export function createIntroController(video: Media, visibility: Visibility, media: IntroMedia, clock: IntroClock, callbacks: {
  frame: (frame: IntroFrame) => void; status: (status: IntroStatus) => void; exit: (reason: IntroExit) => void;
}) {
  const owner = Symbol('intro'); owners.set(video, owner);
  let closed = false, desired = false, resume = false, request = 0, sound = false;
  let raf: number | null = null, timer: number | null = null;
  let lastTime = video.currentTime, deadline = clock.now() + 8000, remaining = 8000;
  const isOwner = () => owners.get(video) === owner;
  const stopScheduling = () => {
    if (raf !== null) clock.cancel(raf); raf = null;
    if (timer !== null) clock.clear(timer); timer = null;
  };
  const silence = () => { if (isOwner()) { video.pause(); video.muted = true; } };
  const remove = () => {
    video.removeEventListener('ended', ended); video.removeEventListener('error', failed);
    video.removeEventListener('loadedmetadata', metadata); video.removeEventListener('pause', unexpectedPause); visibility.removeEventListener('visibilitychange', changed);
  };
  const finish = (reason: IntroExit) => {
    if (closed) return;
    closed = true; desired = false; resume = false; request++;
    stopScheduling(); silence(); remove(); callbacks.exit(reason);
  };
  const validate = () => video.readyState < 1 || (Number.isFinite(video.duration) && Math.abs(video.duration - media.duration) < .15 && video.videoWidth === media.width && video.videoHeight === media.height);
  const tick = () => {
    raf = null;
    if (closed || !desired || visibility.hidden || !isOwner()) return;
    if (!validate()) { finish('failure'); return; }
    if (video.currentTime > lastTime + .001) { lastTime = video.currentTime; deadline = clock.now() + 8000; }
    const frame = introFrame(video.currentTime, media);
    callbacks.frame(frame);
    video.volume = sound ? 1 - frame.reveal : 0;
    // A decoder can omit ended after the last frame. Only actual near-end media time admits completion.
    if (video.ended || (video.currentTime >= media.duration - .06 && clock.now() - (deadline - 8000) >= 250)) { finish('complete'); return; }
    raf = clock.request(tick);
  };
  const watchdog = () => {
    timer = null;
    if (closed || !desired || visibility.hidden) return;
    if (clock.now() >= deadline) { finish('timeout'); return; }
    timer = clock.after(watchdog, Math.min(250, deadline - clock.now()));
  };
  const schedule = () => {
    if (raf === null) raf = clock.request(tick);
    if (timer === null) timer = clock.after(watchdog, 250);
  };
  const play = async () => {
    if (closed || !isOwner()) return;
    desired = true;
    if (visibility.hidden) { resume = true; return; }
    const current = ++request;
    deadline = clock.now() + remaining;
    video.muted = !sound;
    callbacks.status('loading'); schedule();
    try {
      await video.play();
      if (!isOwner()) return;
      if (closed || visibility.hidden || !desired) { silence(); return; }
      if (current === request) callbacks.status('playing');
    } catch {
      if (!closed && isOwner() && current === request) {
        desired = false; resume = false; stopScheduling(); callbacks.status('blocked');
      }
    }
  };
  const pause = () => {
    if (closed) return;
    request++; desired = false; resume = false; remaining = Math.max(1, deadline - clock.now());
    stopScheduling(); video.pause(); callbacks.status('paused');
  };
  const changed = () => {
    if (closed) return;
    if (visibility.hidden) {
      resume = desired; remaining = Math.max(1, deadline - clock.now()); request++;
      stopScheduling(); video.pause();
    } else if (resume) { resume = false; void play(); }
  };
  const unexpectedPause = () => {
    if (closed || !desired || visibility.hidden || video.ended || !video.paused) return;
    request++; desired = false; resume = false; remaining = 8000;
    stopScheduling(); callbacks.status('blocked');
  };
  const ended = () => {
    if (!closed && validate() && video.currentTime >= media.duration - .15) finish('complete');
    else if (!closed) finish('failure');
  };
  const failed = () => finish('failure');
  const metadata = () => { if (!validate()) finish('failure'); };
  video.muted = true; video.volume = 0;
  video.addEventListener('ended', ended); video.addEventListener('error', failed);
  video.addEventListener('loadedmetadata', metadata); video.addEventListener('pause', unexpectedPause); visibility.addEventListener('visibilitychange', changed);
  return { play, pause, finish, setSound(enabled: boolean) {
    if (closed || !isOwner()) return;
    sound = enabled; video.muted = !enabled;
    video.volume = enabled ? 1 - introFrame(video.currentTime, media).reveal : 0;
  }, dispose() {
    if (!closed) { closed = true; desired = false; resume = false; request++; stopScheduling(); silence(); remove(); }
    // Retain ownership until another controller replaces it, so late promises still stop their own element.
  } };
}
