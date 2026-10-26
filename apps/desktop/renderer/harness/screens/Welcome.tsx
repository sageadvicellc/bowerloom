/**
 * S1.1, Welcome. The leaf, the name, one sentence in two lines, what a harness is, the one button, and one quiet line that says Bowerloom only reads. "Find my files" goes to Choose sources.
 * The button has the focus when the screen opens, so Enter goes straight on.
 */
import { useEffect, useRef } from 'react';
import type { ReactElement } from 'react';
import { KitIcon } from '../../home/kit/icons.js';
import { HButton } from '../parts/controls.js';
import { FirstRunFrame } from '../parts/FirstRunFrame.js';
import { go } from '../router.js';
import { WORDS } from '../words.js';
import { FLOW } from '../words-flow.js';
import './first-run.css';

export function Welcome(): ReactElement {
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => { button.current?.focus(); }, []);
  return (
    <FirstRunFrame slot="welcome">
      <span className="hxf-leaf" aria-hidden="true"><KitIcon name="leaf" size={24} /></span>
      <h1 className="hxf-name" tabIndex={-1}>{WORDS.label.appName}</h1>
      <p className="hxf-lead"><span>{FLOW.hint.welcomeLineOne}</span> <span>{FLOW.hint.welcomeLineTwo}</span></p>
      <p className="hxf-plain">{WORDS.hint.helpOne}</p>
      <HButton ref={button} icon="search" variant="primary" onClick={() => go({ name: 'choose' })}>{FLOW.label.findMyFiles}</HButton>
      <p className="hxf-plain hxf-go">{WORDS.paragraph.welcomeLine}</p>
    </FirstRunFrame>
  );
}
