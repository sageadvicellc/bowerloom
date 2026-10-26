/**
 * An icon button: a 32 px square with one standard icon, no words on it, and a tooltip. The button keeps its name in `aria-label` (so a screen reader hears it) and is
 * described by the tooltip (see Tooltip.tsx), which opens after 400 ms of hover, at once for the keyboard, and hides on Escape. Use it where the icon alone says what
 * the button does (close, back, undo, remove, copy, search, show more); keep words where an icon would be a guess (a primary action, a destructive confirm). The tooltip's
 * words default to the name; a button that is held back (read only) puts the reason there instead.
 */
import type { ReactElement } from 'react';
import { Button } from './Button.js';
import type { ButtonProps } from './Button.js';
import type { KitIconName } from './icons.js';
import { Tooltip } from './Tooltip.js';
import type { TipSide } from './Tooltip.js';

export interface IconButtonProps extends Omit<ButtonProps, 'icon' | 'children' | 'round' | 'size' | 'iconOnly' | 'aria-label'> {
  icon: KitIconName;
  /** The name of the button, for a screen reader. At most 5 words. */
  label: string;
  /** The words in the tooltip, when they are not the name. */
  tip?: string;
  /** Which side of the button the tooltip sits on. */
  side?: TipSide;
}

export function IconButton({ icon, label, tip, side = 'left', variant = 'quiet', ...rest }: IconButtonProps): ReactElement {
  return (
    <Tooltip text={tip ?? label} side={side}>
      {aria => <Button {...rest} variant={variant} icon={icon} iconOnly aria-label={label} {...aria} />}
    </Tooltip>
  );
}
