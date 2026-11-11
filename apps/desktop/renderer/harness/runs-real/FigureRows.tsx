/**
 * The figures of one run as a short list: time taken, input, output, model and outcome, each "Not read" when the log did not hold it or was not read, and the line that says why. Each reason has its own
 * words (shared/harness/runs-real.ts), and a refusal of the call has the words of its code, never "could not read the log". `label` is the project written with `~`: the line says where Bowerloom looked.
 * Never any text of a chat: the figures are numbers and short words (shared/api/runs.ts).
 */
import type { ReactElement } from 'react';
import { figureRows, figuresStateWords, runsRefusalWords } from '../../../shared/harness/runs-real.js';
import { HButton } from '../parts/controls.js';
import type { FiguresControl } from './runs-session.js';
import { RUNS_REAL } from '../runs-real-words.js';

export function FigureRows({ figures: control, label }: { figures: FiguresControl; label: string }): ReactElement {
  const view = control.view;
  const figures = view.kind === 'ready' ? view.figures : null;
  const why = view.kind === 'refused' ? runsRefusalWords(view.code) : figures === null ? null : figuresStateWords(figures.state, figures.reason, label);
  return (
    <div className="hrr-figures" data-figures={view.kind === 'refused' ? 'refused' : figures === null ? 'loading' : figures.state} data-reason={figures?.reason ?? undefined}>
      {view.kind === 'loading' ? <p className="hx-text hx-muted" role="status">{RUNS_REAL.hint.figuresLoading}</p> : null}
      {why === null ? null : <p className="hx-text" role="status" data-figures-why="">{why}</p>}
      {view.kind === 'loading' ? null : (
        <>
        <dl className="hrr-rows">
          {figureRows(figures).map(row => (
            <div key={row.key} className="hrr-row" data-figure={row.key}>
              <dt>{row.label}</dt><dd data-unread={row.value === 'Not read' ? '' : undefined}>{row.value}</dd>
            </div>
          ))}
        </dl>
        <HButton size="small" data-reread="" aria-disabled={control.busy ? true : undefined} onClick={control.reread}>{control.busy ? RUNS_REAL.label.reading : RUNS_REAL.label.readAgain}</HButton>
        </>
      )}
    </div>
  );
}
