/**
 * The small controls of the preview, built on the kit's Button and Tooltip: a button with one of the preview's icons, an icon button with a tooltip, and a state as a dot and words.
 * A state is never a pill and never a tick: it is a small dot and the words that say it, so the colour is never the only signal.
 */
import type { ReactElement, ReactNode } from 'react';
import { Button } from '../../home/kit/Button.js';
import type { ButtonProps } from '../../home/kit/Button.js';
import { Tooltip } from '../../home/kit/Tooltip.js';
import type { TipSide } from '../../home/kit/Tooltip.js';
import { HIcon } from '../icons.js';
import type { HarnessIconName } from '../icons.js';
import type { Tone } from '../../../shared/harness/status.js';

export interface HButtonProps extends Omit<ButtonProps, 'icon'> { icon?: HarnessIconName }

/** A kit button with one of the preview's icons before its words. */
export function HButton({ icon, children, ...rest }: HButtonProps): ReactElement {
  return <Button {...rest}>{icon === undefined ? null : <HIcon name={icon} size={18} />}{children}</Button>;
}

export interface HIconButtonProps extends Omit<ButtonProps, 'icon' | 'children' | 'round' | 'size' | 'iconOnly' | 'aria-label'> {
  icon: HarnessIconName;
  /** The name of the button, for a screen reader. At most 5 words. */
  label: string;
  /** The words of the tooltip, when they are not the name. */
  tip?: string;
  side?: TipSide;
  /** The size of the icon. */
  size?: number;
}

/** A 32 px square button with one icon, no words, and a tooltip. */
export function HIconButton({ icon, label, tip, side = 'left', size = 20, variant = 'quiet', ...rest }: HIconButtonProps): ReactElement {
  return (
    <Tooltip text={tip ?? label} side={side}>
      {aria => <Button {...rest} variant={variant} iconOnly aria-label={label} aria-describedby={[aria['aria-describedby'], rest['aria-describedby']].filter(Boolean).join(' ') || undefined}><HIcon name={icon} size={size} /></Button>}
    </Tooltip>
  );
}

/** A state: a small dot and the words. */
export function StateDot({ tone, children, className }: { tone: Tone; children: ReactNode; className?: string }): ReactElement {
  return <span className={className === undefined ? 'hx-state' : `hx-state ${className}`} data-tone={tone}><span className="hx-dot" aria-hidden="true" /><span>{children}</span></span>;
}
