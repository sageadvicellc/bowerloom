/**
 * The first screen, every launch (kept in memory only, nothing is stored): the logo, one sentence, one button, and one quiet line that says nothing is
 * changed until Save. The sentence has 13 words, so it is set as two lines of one sentence, each within the text budget. The button has the focus, so
 * Enter goes straight on. The look is in find.css.
 */
import { useEffect, useRef } from 'react';
import type { ReactElement } from 'react';
import { Button } from '../kit/Button.js';
import { KitIcon } from '../kit/icons.js';
import { WORDS } from '../words.js';
import { FIND_WORDS } from './find-words.js';
import './find.css';

export function Welcome({ onFind }: { onFind(): void }): ReactElement {
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => { button.current?.focus(); }, []);
  return (
    <div className="fr-root" data-home="" data-screen="welcome">
      <main id="main" className="fr-welcome">
        <h1 className="fr-brand"><KitIcon name="leaf" size={40} /><span>{WORDS.label.appName}</span></h1>
        <p className="fr-lead"><span>{FIND_WORDS.hint.welcomeLineOne}</span> <span>{FIND_WORDS.hint.welcomeLineTwo}</span></p>
        <div className="fr-welcome-action">
          <Button variant="primary" ref={button} onClick={onFind}>{FIND_WORDS.label.findMyAgents}</Button>
          <p className="fr-note">{FIND_WORDS.hint.welcomeNote}</p>
        </div>
      </main>
    </div>
  );
}
