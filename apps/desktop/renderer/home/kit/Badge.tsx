/** A small state badge: an icon and words, so the state is never colour alone. With `onPress` it is a button (the person can click "2 different copies"). */
import type { ReactElement } from 'react';
import { CARD_WORDS } from '../../../shared/home/cards.js';
import type { CardBadge } from '../../../shared/home/cards.js';
import { KitIcon } from './icons.js';
import type { KitIconName } from './icons.js';

export type BadgeTone = CardBadge['tone'];

/** The icon that goes with a badge: a key for a missing key, else by tone. */
export function badgeIcon(badge: CardBadge): KitIconName {
  if (badge.label === CARD_WORDS.needsKey) return 'key';
  return badge.tone === 'warn' ? 'warning' : badge.tone === 'new' ? 'sparkle' : 'info';
}

export function Badge({ badge, onPress }: { badge: CardBadge; onPress?: () => void }): ReactElement {
  const inside = <><KitIcon name={badgeIcon(badge)} size={16} /><span>{badge.label}</span></>;
  return onPress === undefined
    ? <span className="kit-badge" data-tone={badge.tone} data-no-drag="">{inside}</span>
    : <button type="button" className="kit-badge" data-tone={badge.tone} data-no-drag="" onClick={onPress}>{inside}</button>;
}
