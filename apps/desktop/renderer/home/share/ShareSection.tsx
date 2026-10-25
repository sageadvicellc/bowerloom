/**
 * The Share section at the foot of the Save points drawer: two buttons. "Share my agents" opens the Share sheet; "Open a shared file" opens the Add drawer
 * on its "From a shared file" tab. The section only asks; the page does the opening.
 */
import type { ReactElement } from 'react';
import { Button } from '../kit/Button.js';
import { SHARE_WORDS } from './share-words.js';
import './share.css';

const L = SHARE_WORDS.label, H = SHARE_WORDS.hint;

export interface ShareSectionProps {
  onShare(): void;
  onOpenFile(): void;
}

export function ShareSection({ onShare, onOpenFile }: ShareSectionProps): ReactElement {
  return (
    <section className="sh-section" aria-labelledby="sh-section-title" data-share-section="">
      <div className="sh-section-head">
        <h3 className="kit-heading" id="sh-section-title">{L.share}</h3>
        <p className="kit-hint">{H.shareTip}</p>
      </div>
      <div className="sh-section-actions">
        <Button icon="share" onClick={onShare}>{L.shareAgents}</Button>
        <Button icon="note" onClick={onOpenFile}>{L.openFile}</Button>
      </div>
    </section>
  );
}
