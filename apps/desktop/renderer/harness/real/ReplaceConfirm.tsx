/**
 * The question before a read or the sample replaces harnesses the person already made: one plain line and two buttons. "Cancel" has the focus, so Enter does not replace anything.
 */
import { useEffect, useRef } from 'react';
import type { ReactElement } from 'react';
import { HButton } from '../parts/controls.js';
import { REAL } from './words-real.js';
import './real.css';

export function ReplaceConfirm({ yes, onYes, onCancel }: { yes: string; onYes(): void; onCancel(): void }): ReactElement {
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => { cancel.current?.focus({ preventScroll: true }); }, []);
  return (
    <div className="hxr-nothing" role="group" aria-label={REAL.label.replaceTitle} data-replace-confirm="">
      <p className="hxf-line">{REAL.hint.replaceLine}</p>
      <div className="hxf-actions">
        <HButton ref={cancel} onClick={onCancel}>{REAL.label.cancel}</HButton>
        <HButton variant="primary" onClick={onYes}>{yes}</HButton>
      </div>
    </div>
  );
}
