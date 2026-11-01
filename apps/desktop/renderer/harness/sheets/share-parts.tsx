/**
 * The parts the Export and Import sheets share: what a bundle holds, with the risky parts first. A top block says what to check (tools, values and the hosts they go to,
 * files that can run, paths of another computer) and jumps to each; the lists follow in that order. Every list shows at most SHARE_LIST_LIMIT rows and ends with
 * "and N more", and the top block counts what a cut hides.
 *
 * What a person must read under a tick is never cut: a command, each argument, a host, a path and a sink show in full, wrapped, one per line. Only a name is cut, to two
 * lines, with a "Show all" button that says whether it is open. Main passed every string through `visible()` before it got here, and the text is drawn as plain text.
 */
import { useEffect, useId, useState } from 'react';
import type { ReactElement, ReactNode, RefObject } from 'react';
import { SHARE_LIST_LIMIT } from '../../../shared/engine/types.js';
import type { ShareList, ShareSecret, ShareSummary, ShareTool } from '../../../shared/engine/types.js';
import { HButton, StateDot } from '../parts/controls.js';
import {
  CODE_WHY_WORDS, FLAG_WORDS, SHARE, downloadsCode, eventWords, hiddenCounts, hiddenWords, jumpName, moreWords, runsShellLine, secretKindWords, sinkWords, summaryLine, transportWords,
} from '../words-share.js';
import './engine.css';
import './share.css';

/** A text from a file that a person must read in full: plain, wrapped, never cut, one block. */
export function Full({ children, mono = false }: { children?: ReactNode; mono?: boolean }): ReactElement {
  return <span className={mono ? 'hxsh-full hxe-mono' : 'hxsh-full'} dir="auto" data-budget="content">{children}</span>;
}

/** The longest name drawn whole. A longer one is cut to two lines, and a button opens it. */
export const NAME_LIMIT = 80;

/** A name from a file. A long one is cut to two lines with "Show all", a button that says whether it is open. */
export function Name({ children, mono = false }: { children: string; mono?: boolean }): ReactElement {
  const id = useId(), [open, setOpen] = useState(false), long = children.length > NAME_LIMIT;
  return (
    <span className="hxsh-name-wrap">
      <span id={id} className={`${mono ? 'hxsh-name hxe-mono' : 'hxsh-name'}`} data-cut={long && !open ? '' : undefined} dir="auto" data-budget="content">{children}</span>
      {long ? <HButton size="small" aria-expanded={open} aria-controls={id} aria-label={open ? SHARE.label.showLess : SHARE.label.showAll} aria-describedby={id} onClick={() => setOpen(o => !o)}>{open ? SHARE.label.showLess : SHARE.label.showAll}</HButton> : null}
    </span>
  );
}

/** A section with a name a button can jump to. The heading takes the focus when it is jumped to. */
export function ShareSection({ id, title, count, children, slot }: { id: string; title: string; count?: string; children?: ReactNode; slot: string }): ReactElement {
  return (
    <section className="hxe-section" aria-labelledby={`${id}-h`} id={id} data-section={slot}>
      <h3 className="hxe-head" id={`${id}-h`} tabIndex={-1}><span>{title}</span>{count === undefined ? null : <span className="hxe-count">{count}</span>}</h3>
      {children}
    </section>
  );
}

/** The rows of a list that main may have cut. Shows at most `limit` rows, then "and N more". An empty list says so in words. */
export function Capped<T>({ list, label, empty, render, limit = SHARE_LIST_LIMIT }: { list: ShareList<T>; label: string; empty: string; render(row: T, index: number): ReactElement; limit?: number }): ReactElement {
  const rows = list.rows.slice(0, limit), more = list.more + (list.rows.length - rows.length);
  if (rows.length === 0 && more === 0) return <p className="hxe-text hxe-muted" data-empty="">{empty}</p>;
  return (
    <ul className="hxsh-list" aria-label={label}>
      {rows.map(render)}
      {more > 0 ? <li className="hxe-muted hxsh-more" data-more={more}>{moreWords(more)}</li> : null}
    </ul>
  );
}
/** The size of a list, rows and the rest. */
export const totalOf = (list: ShareList<unknown>): number => list.rows.length + list.more;

/**
 * True while the sheet's body scrolls, so the region that holds the text can take a Tab stop and the keyboard can scroll it (a scroller with no control in it is not
 * reached by Tab). `scroller` is the element that scrolls.
 */
export function useScrolls(scroller: RefObject<HTMLElement | null>, dep: unknown): boolean {
  const [scrolls, setScrolls] = useState(false);
  useEffect(() => {
    const el = scroller.current?.parentElement;
    if (el === null || el === undefined) return undefined;
    const measure = (): void => setScrolls(el.scrollHeight > el.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    if (scroller.current !== null) observer.observe(scroller.current);
    return () => observer.disconnect();
  }, [scroller, dep]);
  return scrolls;
}

function ToolRow({ tool }: { tool: ShareTool }): ReactElement {
  const words = tool.kind === 'hook' ? (tool.event === null ? null : eventWords(tool.event)) : transportWords(tool.transport);
  const downloads = tool.kind !== 'hook' && downloadsCode(tool.command, tool.args), shell = runsShellLine(tool.command, tool.args);
  // A program that is started says so once, in the badge; the transport line is for a tool that reaches an address.
  const startsProgram = tool.kind !== 'hook' && tool.runsCode;
  return (
    <li className="hxsh-row" data-tool={tool.name} data-kind={tool.kind} data-runs-code={tool.runsCode ? '' : undefined}>
      <span className="hxsh-row-head">
        <Name>{tool.name}</Name>
        <span className="hxe-muted">{tool.kind === 'hook' ? SHARE.label.hook : SHARE.label.server}</span>
        {tool.runsCode ? <StateDot tone="warn">{SHARE.label.runsCode}</StateDot> : null}
      </span>
      {startsProgram && words !== null ? null : words === null ? (tool.transport === null ? null : <span className="hxsh-line hxe-muted" data-transport="">{SHARE.label.server}: <Full mono>{tool.transport}</Full></span>) : <span className="hxsh-line" data-transport="">{words}</span>}
      {downloads ? <span className="hxsh-line" data-downloads=""><StateDot tone="warn">{SHARE.hint.downloads}</StateDot></span> : null}
      {shell ? <span className="hxsh-line" data-shell=""><StateDot tone="warn">{SHARE.hint.shellLine}</StateDot></span> : null}
      {tool.command === null ? null : <span className="hxsh-line" data-command=""><span className="hxe-muted">{SHARE.label.command}</span> <Full mono>{tool.command}</Full></span>}
      {tool.args.length === 0 ? null : (
        <ol className="hxsh-args" aria-label={SHARE.label.arguments}>
          {tool.args.map((arg, i) => <li key={i} data-arg={i}><Full mono>{arg}</Full></li>)}
        </ol>
      )}
      {tool.event === null ? null : <span className="hxsh-line hxe-muted" data-event="">{SHARE.label.event}: <Full mono>{tool.event}</Full></span>}
      {tool.host === null ? null : <span className="hxsh-line" data-host="">{SHARE.label.reaches}: <Full mono>{tool.host}</Full></span>}
      {tool.flags.map(flag => <span key={flag} className="hxsh-line" data-flag={flag}><StateDot tone="bad">{FLAG_WORDS[flag]}</StateDot></span>)}
    </li>
  );
}

function SecretRow({ secret }: { secret: ShareSecret }): ReactElement {
  return (
    <li className="hxsh-row" data-secret={secret.name} data-kind={secret.kind}>
      <span className="hxsh-row-head"><Full mono>{secret.name}</Full><span className="hxe-muted">{secretKindWords(secret)}</span></span>
      <Capped list={{ rows: secret.sinks, more: 0 }} label={SHARE.label.usedBy} empty={SHARE.hint.noSinks}
        render={(sink, i) => <li key={`${sink.tool}:${sink.field}:${i}`} className="hxsh-line" data-sink={sink.field}><Full>{sinkWords(sink)}</Full></li>} />
    </li>
  );
}

/** The values the file reads from this computer, each with the tool and host it goes to. The Done step of an import draws this list again. */
export function SecretsSection({ summary, side, id }: { summary: ShareSummary; side: 'export' | 'import'; id: string }): ReactElement {
  return (
    <ShareSection id={id} title={SHARE.label.secretsHead} count={String(totalOf(summary.secrets))} slot="share-secrets">
      <Capped list={summary.secrets} label={SHARE.label.secretsHead} empty="" render={(secret, i) => <SecretRow key={`${secret.kind}:${secret.name}:${i}`} secret={secret} />} />
      {totalOf(summary.secrets) === 0 ? null : (
        <>
          <p className="hxe-text hxe-muted">{side === 'import' ? SHARE.hint.secretsImport : SHARE.hint.secretsExport}</p>
          <p className="hxe-text hxe-muted">{SHARE.hint.secretsGo}</p>
          <p className="hxe-text hxe-muted">{SHARE.hint.notChecked}</p>
        </>
      )}
    </ShareSection>
  );
}

/** Scrolls to a section and puts the focus on its heading. */
function jump(id: string): void {
  const heading = document.getElementById(`${id}-h`);
  heading?.scrollIntoView({ block: 'start' });
  heading?.focus({ preventScroll: true });
}

export interface CheckBlockProps { summary: ShareSummary; side: 'export' | 'import'; ids: { tools: string; secrets: string; code: string; paths: string } }

/** "Check before you go on": what runs, where values go, which files can run, and which paths came along, each a button that jumps to its list. */
export function CheckBlock({ summary, side, ids }: CheckBlockProps): ReactElement {
  const hidden = hiddenCounts(summary), tools = totalOf(summary.tools), code = totalOf(summary.codeFiles), values = totalOf(summary.secrets), paths = totalOf(summary.foreignPaths);
  const items: { key: string; id: string; words: string }[] = [
    ...(tools > 0 ? [{ key: 'tools', id: ids.tools, words: `${tools} ${tools === 1 ? 'tool' : 'tools'}` }] : []),
    ...(values > 0 ? [{ key: 'secrets', id: ids.secrets, words: `${values} ${values === 1 ? 'value goes' : 'values go'} to tools` }] : []),
    ...(code > 0 ? [{ key: 'code', id: ids.code, words: `${code} ${code === 1 ? 'file can' : 'files can'} run` }] : []),
    ...(paths > 0 ? [{ key: 'paths', id: ids.paths, words: `${paths} ${paths === 1 ? 'path' : 'paths'} from ${side === 'import' ? 'another' : 'this'} computer` }] : []),
  ];
  return (
    <section className="hxsh-check" aria-labelledby={`${ids.tools}-check`} data-check="">
      <h3 className="hxe-head" id={`${ids.tools}-check`}>{SHARE.label.checkHead}</h3>
      {items.length === 0 ? <p className="hxe-text" data-nothing="">{SHARE.hint.nothingRuns}</p> : (
        <ul className="hxsh-check-list">
          {items.map(item => <li key={item.key}><HButton size="small" data-jump={item.key} aria-label={jumpName(item.words)} onClick={() => jump(item.id)}>{item.words}</HButton></li>)}
        </ul>
      )}
      {hidden.total === 0 ? null : <p className="hxe-text" role="status" data-hidden={hidden.total}><StateDot tone="bad">{hiddenWords(hidden.total)}</StateDot></p>}
    </section>
  );
}

export interface ShareSummaryViewProps {
  summary: ShareSummary;
  /** `export` lists paths of this computer; `import` lists paths of another one. */
  side: 'export' | 'import';
  /** False when the sheet draws the notes names itself (the import's choices). */
  notes?: boolean;
}

/** What a bundle holds, the risky parts first: the line of counts, the check block, tools, values, files that can run, paths, borrowed items, notes names. */
export function ShareSummaryView({ summary, side, notes = true }: ShareSummaryViewProps): ReactElement {
  const base = useId();
  const ids = { tools: `${base}-tools`, secrets: `${base}-secrets`, code: `${base}-code`, paths: `${base}-paths` };
  const hasTools = totalOf(summary.tools) > 0, hasCode = totalOf(summary.codeFiles) > 0, hasSecrets = totalOf(summary.secrets) > 0, hasPaths = totalOf(summary.foreignPaths) > 0;
  return (
    <div className="hxsh-stack" data-share-summary={side}>
      <p className="hxe-text" data-summary-line="">
        <span className="hxe-muted">{SHARE.label.harness}</span> <Name mono>{summary.harness}</Name>
        <span className="hxsh-summary" data-budget="content"> {summaryLine(summary)}</span>
      </p>
      <CheckBlock summary={summary} side={side} ids={ids} />
      {hasTools ? (
        <ShareSection id={ids.tools} title={SHARE.label.toolsHead} count={String(totalOf(summary.tools))} slot="share-tools">
          <Capped list={summary.tools} label={SHARE.label.toolsHead} empty="" render={(tool, i) => <ToolRow key={`${tool.kind}:${tool.name}:${i}`} tool={tool} />} />
          <p className="hxe-text hxe-muted">{SHARE.hint.toolsNote}</p>
        </ShareSection>
      ) : null}
      {hasSecrets ? <SecretsSection summary={summary} side={side} id={ids.secrets} /> : null}
      {hasCode ? (
        <ShareSection id={ids.code} title={SHARE.label.codeHead} count={String(totalOf(summary.codeFiles))} slot="share-code">
          <Capped list={summary.codeFiles} label={SHARE.label.codeHead} empty=""
            render={(file, i) => (
              <li key={`${file.path}:${i}`} className="hxsh-row" data-code-file={file.path} data-why={file.why}>
                <Full mono>{file.path}</Full>
                <span className="hxe-muted">{CODE_WHY_WORDS[file.why]}</span>
              </li>
            )} />
          <p className="hxe-text hxe-muted">{SHARE.hint.codeNote}</p>
        </ShareSection>
      ) : null}
      {hasPaths ? (
        <ShareSection id={ids.paths} title={side === 'import' ? SHARE.label.pathsOther : SHARE.label.pathsHere} count={String(totalOf(summary.foreignPaths))} slot="share-paths">
          <Capped list={summary.foreignPaths} label={side === 'import' ? SHARE.label.pathsOther : SHARE.label.pathsHere} empty=""
            render={(hit, i) => (
              <li key={`${hit.path}:${hit.line ?? 0}:${i}`} className="hxsh-row" data-foreign-path={hit.path}>
                <span className="hxsh-row-head"><Full mono>{hit.path}</Full>{hit.line === null ? null : <span className="hxe-muted">{SHARE.label.line} {hit.line}</span>}</span>
                <span className="hxsh-line"><Full mono>{hit.text}</Full></span>
              </li>
            )} />
          <p className="hxe-text hxe-muted">{side === 'import' ? SHARE.hint.pathsImport : SHARE.hint.pathsExport}</p>
        </ShareSection>
      ) : null}
      {totalOf(summary.borrowed) === 0 ? null : (
        <ShareSection id={`${base}-borrowed`} title={SHARE.label.borrowedHead} count={String(totalOf(summary.borrowed))} slot="share-borrowed">
          <Capped list={summary.borrowed} label={SHARE.label.borrowedHead} empty=""
            render={(item, i) => (
              <li key={`${item.name}:${i}`} className="hxsh-row" data-borrowed={item.name}>
                <Name>{item.name}</Name>
                <span className="hxe-muted"><Full>{`${item.marketplace}, ${item.version}`}</Full></span>
              </li>
            )} />
        </ShareSection>
      )}
      {notes && totalOf(summary.notes) > 0 ? (
        <ShareSection id={`${base}-notes`} title={SHARE.label.notesHead} count={String(totalOf(summary.notes))} slot="share-notes">
          <Capped list={summary.notes} label={SHARE.label.notesHead} empty=""
            render={(note, i) => (
              <li key={`${note.name}:${i}`} className="hxsh-row" data-note={note.name}>
                <Name>{note.name}</Name>
                {note.readBy.length === 0 ? null : <span className="hxe-muted">{SHARE.label.readBy}: <Full>{note.readBy.join(', ')}</Full></span>}
              </li>
            )} />
          <p className="hxe-text hxe-muted">{SHARE.hint.notesOut}</p>
        </ShareSection>
      ) : null}
    </div>
  );
}
