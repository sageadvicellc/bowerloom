/**
 * The tile that leads a card: a rounded square with the glyph of the card's kind (a skill's bolt, a tool's plug, a note's page, an agent's three nodes). Every
 * card family wears the same tile, so an agent card does not borrow the look of a human profile. It is decoration; the name beside it says the same.
 */
import type { ReactElement } from 'react';
import { KitIcon } from './icons.js';
import type { KitIconName } from './icons.js';

export function Glyph({ name, size = 'normal' }: { name: KitIconName; size?: 'large' | 'normal' | 'small' }): ReactElement {
  return <span className="kit-tile" data-size={size === 'normal' ? undefined : size} aria-hidden="true"><KitIcon name={name} size={size === 'large' ? 24 : size === 'small' ? 16 : 20} /></span>;
}
