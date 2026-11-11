/**
 * The figures of one run as a short list: time taken, input, output, model and outcome, each "Not read" when the log did not hold it, and the line that says why when the log was not read.
 * Never any text of a chat: the figures are numbers and short words (shared/api/runs.ts).
 */
import type { ReactElement } from 'react';
import { figureRows, figuresStateWords } from '../../../shared/harness/runs-real.js';
import type { FiguresView } from './runs-session.js';
import { RUNS_REAL } from '../runs-real-words.js';

export function FigureRows({ view }: { view: FiguresView }): ReactElement {
  const figures = view.kind === 'ready' ? view.figures : null;
  const why = figures === null ? null : figuresStateWords(figures.state);
  return (
    <div className="hrr-figures" data-figures={figures === null ? 'loading' : figures.state}>
      {view.kind === 'loading' ? <p className="hx-text hx-muted" role="status">{RUNS_REAL.hint.figuresLoading}</p> : null}
      {why === null ? null : <p className="hx-text" role="status" data-figures-why="">{why}</p>}
      {view.kind === 'loading' ? null : (
        <dl className="hrr-rows">
          {figureRows(figures).map(row => (
            <div key={row.key} className="hrr-row" data-figure={row.key}>
              <dt>{row.label}</dt><dd data-unread={row.value === 'Not read' ? '' : undefined}>{row.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
