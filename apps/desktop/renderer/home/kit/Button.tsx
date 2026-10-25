/** The one button of the kit. Primary is the one thing to do on a screen; quiet is everything else. There is no red one: nothing here destroys anything. */
import type { ButtonHTMLAttributes, ReactElement, Ref } from 'react';
import { KitIcon } from './icons.js';
import type { KitIconName } from './icons.js';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'style'> {
  variant?: 'primary' | 'quiet';
  icon?: KitIconName;
  /** A round button with an icon or one character, for "?" and "Close". It needs an `aria-label`. */
  round?: boolean;
  /** A smaller button, for a "?" that sits in a line of text. It is still 32 px, so it is easy to hit. */
  size?: 'normal' | 'small';
  ref?: Ref<HTMLButtonElement>;
}

export function Button({ variant = 'quiet', icon, round = false, size = 'normal', type = 'button', children, ...rest }: ButtonProps): ReactElement {
  return (
    <button {...rest} type={type} className="kit-button" data-variant={variant} data-round={round ? '' : undefined} data-size={size === 'small' ? 'small' : undefined}>
      {icon === undefined ? null : <KitIcon name={icon} size={20} />}
      {children}
    </button>
  );
}
