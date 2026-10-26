/**
 * The script of the real-mode page (`real.html`, served at the app address in real mode only). It follows the colour scheme of the computer, then mounts the bare test
 * page. When the shell takes the loader in, `mountReal` (mountReal.tsx) is what it calls, and this file is not needed.
 */
import { mountRealHarness } from './mountReal.js';

const media = window.matchMedia('(prefers-color-scheme: dark)');
const follow = (): void => { document.documentElement.setAttribute('data-theme', media.matches ? 'dark' : 'light'); };
follow();
media.addEventListener('change', follow);
mountRealHarness(document.getElementById('root')!);
