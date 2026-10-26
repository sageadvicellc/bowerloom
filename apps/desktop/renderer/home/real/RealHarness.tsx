/**
 * A bare page for trying the real-setup reader without the shell: the loader first, and when it hands over the world, a plain list of what was found. It draws
 * names and hints only, as text. It is the page `#prototype-v2/real-harness` opens, and the one the end-to-end run drives.
 */
import { useCallback, useState } from 'react';
import type { ReactElement } from 'react';
import type { World } from '../../../shared/proto/types.js';
import { clearRealResult, realPlainOf, registerRealResult } from '../../../shared/real/plain-fallback.js';
import type { RealResult } from '../../../shared/real/types.js';
import { RealLoader } from './RealLoader.js';
import { countsLine } from './words.js';

const KIND_TITLES = [['agent', 'Agents'], ['skill', 'Skills'], ['tool', 'Tools']] as const;

function List({ world, kind, title }: { world: World; kind: 'agent' | 'skill' | 'tool'; title: string }): ReactElement {
  const items = world.items.filter(i => i.kind === kind);
  return (
    <section className="rl-section" data-list={kind}>
      <h2 className="rl-heading">{title} <span className="rl-count">{items.length}</span></h2>
      <ul className="rl-list">
        {items.map(item => {
          const plain = realPlainOf(item);
          return (
            <li key={item.id} className="rl-item" data-item={item.id}>
              <strong data-budget="content">{plain.name}</strong> <span className="rl-item-hint" data-budget="content">{plain.hint}</span>
              {plain.where.length === 0 ? null : <span className="rl-item-where" data-budget="content"> ({plain.where.join(', ')})</span>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function RealHarness(): ReactElement {
  const [result, setResult] = useState<RealResult | null>(null);
  const onWorld = useCallback((_world: World, r: RealResult): void => { clearRealResult(); registerRealResult(r); setResult(r); }, []);
  if (result === null) return <RealLoader onWorld={onWorld} />;
  return (
    <div className="rl-root" data-real="" data-step="list">
      <main id="main" className="rl-main">
        <h1 className="rl-title" tabIndex={-1} data-focus="">Your setup</h1>
        <p className="rl-readonly" data-readonly="">Read-only. Nothing is changed or saved.</p>
        <p className="rl-summary" data-summary="">{countsLine(result.counts)}</p>
        {result.notes.map(n => <p key={n} className="rl-hint" data-note="">{n}</p>)}
        {KIND_TITLES.map(([kind, title]) => <List key={kind} world={result.world} kind={kind} title={title} />)}
        <section className="rl-section" data-list="notes">
          <h2 className="rl-heading">Notes <span className="rl-count">{result.world.wikiPages.length}</span></h2>
          <ul className="rl-list">{result.world.slices.map(s => <li key={s.id} className="rl-item" data-budget="content">{s.name}</li>)}</ul>
        </section>
        {result.others.length === 0 ? null : (
          <section className="rl-section" data-list="others">
            <h2 className="rl-heading">Other apps <span className="rl-count">{result.others.length}</span></h2>
            <ul className="rl-list">{result.others.map(o => <li key={`${o.app}-${o.kind}-${o.name}-${o.place}`} className="rl-item" data-budget="content"><strong>{o.name}</strong> {o.app} {o.kind}</li>)}</ul>
          </section>
        )}
      </main>
      <footer className="rl-footer"><span className="rl-badge">Read-only</span></footer>
    </div>
  );
}
