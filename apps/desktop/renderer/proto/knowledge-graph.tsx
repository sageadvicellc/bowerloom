/** The wiki graph as a React component: a canvas for the pages, an overlay for the lasso, and a text summary for people who cannot see the canvas. */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import type { Preview } from '../../shared/proto/slice-preview.js';
import type { LassoMode } from '../../shared/proto/slice-lasso.js';
import type { WikiPage } from '../../shared/proto/types.js';
import { plural } from '../../shared/words.js';
import { GraphView, cutKey, domainsOf } from './knowledge-graph-view.js';

export interface KnowledgeGraphProps {
  readonly pages: readonly WikiPage[];
  /** The pages that are in the slice. They are lit; the rest are dimmed. */
  readonly lit: ReadonlySet<string>;
  /** The picked pages. They get a ring. */
  readonly marked: ReadonlySet<string>;
  /** The numbers of the preview, which also say which links leave the slice. */
  readonly preview: Preview;
  readonly lasso: boolean;
  readonly onLasso: (ids: string[], mode: LassoMode) => void;
  readonly onPageClick: (id: string) => void;
  /** A handle for a test or the window: the view, once it exists. */
  readonly viewRef?: { current: GraphView | null };
}

/** The domain folders of a page list, in the order that decides their colours. */
export { domainsOf };

export function KnowledgeGraph({ pages, lit, marked, preview, lasso, onLasso, onPageClick, viewRef }: KnowledgeGraphProps): ReactElement {
  const hostRef = useRef<HTMLDivElement>(null), overlayRef = useRef<HTMLCanvasElement>(null), view = useRef<GraphView | null>(null);
  const [settled, setSettled] = useState(false), [inside, setInside] = useState<number | null>(null);
  // The latest callbacks, so the view is built once and never rebuilt for a new function.
  const latest = useRef({ onLasso, onPageClick });
  latest.current = { onLasso, onPageClick };

  const cut = useMemo(() => new Set(preview.cut.map(l => cutKey(l.from, l.to))), [preview.cut]);
  const links = useMemo(() => pages.reduce((n, p) => n + p.links.length, 0), [pages]);
  const domains = useMemo(() => domainsOf(pages), [pages]);

  useEffect(() => {
    const host = hostRef.current, overlay = overlayRef.current;
    if (host === null || overlay === null) return undefined;
    setSettled(false);
    const v = new GraphView(host, overlay, {
      onLasso: (ids, mode) => { setInside(null); latest.current.onLasso(ids, mode); },
      onLassoMove: n => setInside(n),
      onPageClick: id => latest.current.onPageClick(id),
      onSettled: () => setSettled(true),
    });
    view.current = v;
    if (viewRef !== undefined) viewRef.current = v;
    void v.start(pages);
    return () => { v.dispose(); view.current = null; if (viewRef !== undefined) viewRef.current = null; };
  }, [pages, viewRef]);

  useEffect(() => { view.current?.setLook({ lit, marked, cut }); }, [lit, marked, cut]);
  // The look is set again when the view is built, because the view may start after the first look was given.
  useEffect(() => { const v = view.current; if (v !== null) v.setLook({ lit, marked, cut }); }, [pages]);
  useEffect(() => { view.current?.setLasso(lasso); }, [lasso]);
  useEffect(() => {
    if (!lasso) return undefined;
    const stop = (e: KeyboardEvent): void => { if (e.key === 'Escape') view.current?.cancel(); };
    document.addEventListener('keydown', stop);
    return () => document.removeEventListener('keydown', stop);
  }, [lasso]);

  const summary = `${plural(pages.length, 'page')}, ${plural(links, 'link')}, ${plural(domains.length, 'domain folder')}. ${plural(preview.count, 'page')} lit as part of the slice and ${plural(pages.length - preview.count, 'page')} dimmed. ${plural(preview.cutCount, 'link')} leave the slice and are drawn dashed.`;
  return (
    <div className="kn-graph">
      <div className="kn-canvas" ref={hostRef} role="img" aria-label={`Graph of the wiki. ${summary}`} aria-describedby="kn-graph-summary" data-settled={settled ? '1' : '0'} />
      <canvas
        className="kn-overlay" ref={overlayRef} aria-hidden="true"
        onPointerDown={e => view.current?.down(e.nativeEvent)} onPointerMove={e => view.current?.move(e.nativeEvent)}
        onPointerUp={e => view.current?.up(e.nativeEvent)} onPointerCancel={() => view.current?.cancel()}
      />
      <p id="kn-graph-summary" className="kn-summary small muted">{summary}</p>
      <p className="kn-status small" role="status" aria-live="polite" data-testid="graph-status">
        {inside !== null ? `${plural(inside, 'page')} inside the loop.` : settled ? 'The graph has settled.' : 'The graph is settling.'}
      </p>
    </div>
  );
}
