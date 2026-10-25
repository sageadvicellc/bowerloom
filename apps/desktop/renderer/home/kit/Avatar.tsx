/** An agent's avatar: a round tinted circle with its initials, or a person when it has no name. The colour comes from the name and is one of the app's graph tokens. */
import type { ReactElement } from 'react';
import { avatarSlot, initialsOf } from './avatar-colour.js';
import { KitIcon } from './icons.js';

export function Avatar({ name, size = 'large' }: { name: string; size?: 'large' | 'small' }): ReactElement {
  const initials = initialsOf(name);
  return (
    <span className="kit-avatar" data-slot={avatarSlot(name)} data-size={size} aria-hidden="true">
      {initials === '' ? <KitIcon name="agent" size={size === 'large' ? 24 : 16} /> : initials}
    </span>
  );
}
