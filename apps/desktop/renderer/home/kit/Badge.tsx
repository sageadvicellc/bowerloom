/**
 * A state, as a small dot and short words: no fill, no border, no pill. The words always say the state ("2 different copies", "needs a key", "Runs code"), so the
 * colour of the dot is never the only signal. With `onPress` it is a text button (the person can click "2 different copies"). The name `Badge` stays, so a screen
 * that already uses it does not change.
 */
import type { ReactElement } from 'react';
import { CARD_WORDS } from '../../../shared/home/cards.js';
import type { CardBadge } from '../../../shared/home/cards.js';
import type { KitIconName } from './icons.js';

export type BadgeTone = CardBadge['tone'];

/** The icon that used to go with a badge. A state is a dot now; this stays for a screen that still asks which icon fits a state (a key for a missing key, else by tone). */
export function badgeIcon(badge: CardBadge): KitIconName {
  if (badge.label === CARD_WORDS.needsKey) return 'key';
  return badge.tone === 'warn' ? 'warning' : badge.tone === 'new' ? 'sparkle' : 'info';
}

export function Badge({ badge, onPress }: { badge: CardBadge; onPress?: () => void }): ReactElement {
  const inside = <><span className="kit-dot" aria-hidden="true" /><span>{badge.label}</span></>;
  return onPress === undefined
    ? <span className="kit-status" data-tone={badge.tone} data-no-drag="">{inside}</span>
    : <button type="button" className="kit-status" data-tone={badge.tone} data-no-drag="" onClick={onPress}>{inside}</button>;
}
