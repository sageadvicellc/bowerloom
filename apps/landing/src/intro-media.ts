export type IntroMedia = {
  kind: 'production' | 'fixture';
  src: string; poster: string; sha256: string; bytes: number;
  width: number; height: number; duration: number; logoAt: number;
  /** Historical field name for the final logo-hold cue. Never authorizes automatic entry. */
  revealAt: number;
  audio: 'embedded' | 'silent';
};
/** Historical 23-second delivery remains preserved. Revised 10–15-second media awaits Brand delivery. */
export const introDelivery: { status: 'awaiting-media' | 'ready'; desktop: IntroMedia | null; portrait: IntroMedia | null } = {
  status: 'awaiting-media',
  desktop: {
    kind: 'production', src: '/intro/cinematic-wide.mp4', poster: '/intro/wide-poster.webp',
    sha256: '9a9e4775250e18c753efef425bb2fdcc18acc906f91e3a68a2988e055d3bdd97', bytes: 10613793,
    width: 1920, height: 1080, duration: 23, logoAt: 20, revealAt: 22.2, audio: 'embedded',
  },
  portrait: {
    kind: 'production', src: '/intro/cinematic-tall.mp4', poster: '/intro/tall-poster.webp',
    sha256: 'c58a64b98f00ab9897e4c662017ee0e819b48ecc67e23f74596e07f4ff257d80', bytes: 10916915,
    width: 1080, height: 1920, duration: 23, logoAt: 20, revealAt: 22.2, audio: 'embedded',
  },
};
/** Technical patterns and test tone, admitted only by ?intro=fixture. Never final media. */
export const introFixtures: Record<'desktop' | 'portrait', IntroMedia> = {
  "desktop": {
    "kind": "fixture",
    "src": "/_diagnostics/intro/landscape.mp4",
    "poster": "/_diagnostics/intro/poster.svg",
    "sha256": "94dcb08bb683ec13ba01b1e959e82518466676e68b6ff2de028749dd7f934362",
    "bytes": 475662,
    "width": 1280,
    "height": 720,
    "duration": 23,
    "logoAt": 20,
    "revealAt": 22.2,
    "audio": "embedded"
  },
  "portrait": {
    "kind": "fixture",
    "src": "/_diagnostics/intro/portrait.mp4",
    "poster": "/_diagnostics/intro/poster.svg",
    "sha256": "875e6beeb02f780edaf243808f9318d3dd661434635bce9c37feb2728426fc48",
    "bytes": 423397,
    "width": 720,
    "height": 1280,
    "duration": 23,
    "logoAt": 20,
    "revealAt": 22.2,
    "audio": "embedded"
  }
};
export function selectIntroMedia(fixture: boolean, portrait: boolean, delivery = introDelivery): IntroMedia | null {
  if (fixture) return introFixtures[portrait ? 'portrait' : 'desktop'];
  if (delivery.status !== 'ready') return null;
  if (!validProductionMedia(delivery.desktop, false) || !validProductionMedia(delivery.portrait, true)) return null;
  if (delivery.desktop.duration !== delivery.portrait.duration || delivery.desktop.logoAt !== delivery.portrait.logoAt || delivery.desktop.revealAt !== delivery.portrait.revealAt) return null;
  return portrait ? delivery.portrait : delivery.desktop;
}

export function validProductionMedia(media: IntroMedia | null, portrait: boolean): media is IntroMedia {
  return Boolean(media && media.kind === 'production' && media.src.startsWith('/intro/') && media.poster.startsWith('/intro/')
    && /^[a-f0-9]{64}$/.test(media.sha256) && media.bytes > 0 && media.bytes <= 16 * 1024 * 1024
    && media.width === (portrait ? 1080 : 1920) && media.height === (portrait ? 1920 : 1080)
    && Number.isFinite(media.duration) && media.duration >= 10 && media.duration <= 15
    && Number.isFinite(media.logoAt) && media.logoAt >= 0 && media.logoAt + .8 <= media.revealAt
    && Number.isFinite(media.revealAt) && media.revealAt <= media.duration - .4 && media.audio === 'embedded');
}
