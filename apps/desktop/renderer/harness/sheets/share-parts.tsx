/**
 * The parts the Export and Import sheets share: what a bundle holds, as one list per kind (counts, tools with their command or host and flags, files that can run
 * with why, values read from this computer with the tool and host each goes to, notes names, borrowed items, and paths of another computer). Every list shows at
 * most SHARE_LIST_LIMIT rows and ends with "and N more". Every text that came from a file is drawn as plain text, cut to three lines, and never wraps the layout.
 * Main passed each string through `visible()` before it got here.
 */
import type { ReactElement, ReactNode } from 'react';
import { SHARE_LIST_LIMIT } from '../../../shared/engine/types.js';
import type { ShareList, ShareSecret, ShareSummary, ShareTool } from '../../../shared/engine/types.js';
import { StateDot } from '../parts/controls.js';
import { CODE_WHY_WORDS, FLAG_WORDS, SHARE, fileSizeWords, moreWords, secretKindWords, sinkWords } from '../words-share.js';
import { Section } from './engine-parts.js';
import './share.css';

/** A text from a file: plain, cut to three lines, never wider than its box. */
export function Cut({ children, mono = false }: { children?: ReactNode; mono?: boolean }): ReactElement {
  return <span className={mono ? 'hxsh-cut hxe-mono' : 'hxsh-cut'} data-budget="content">{children}</span>;
}

/** The rows of a list that main may have cut. Shows at most SHARE_LIST_LIMIT rows, then "and N more". An empty list says so in words. */
export function Capped<T>({ list, label, empty, render }: { list: ShareList<T>; label: string; empty: string; render(row: T, index: number): ReactElement }): ReactElement {
  const rows = list.rows.slice(0, SHARE_LIST_LIMIT), more = list.more + (list.rows.length - rows.length);
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

function ToolRow({ tool }: { tool: ShareTool }): ReactElement {
  return (
    <li className="hxsh-row" data-tool={tool.name} data-kind={tool.kind} data-runs-code={tool.runsCode ? '' : undefined}>
      <span className="hxsh-row-head">
        <Cut>{tool.name}</Cut>
        <span className="hxe-muted">{tool.kind === 'hook' ? SHARE.label.hook : SHARE.label.server}{tool.transport === null ? '' : `, ${tool.transport}`}</span>
        {tool.runsCode ? <StateDot tone="warn">{SHARE.label.runsCode}</StateDot> : null}
      </span>
      {tool.command === null ? null : <span className="hxsh-line" data-command=""><Cut mono>{[tool.command, ...tool.args].join(' ')}</Cut></span>}
      {tool.event === null ? null : <span className="hxsh-line hxe-muted">{SHARE.label.event}: <Cut>{tool.event}</Cut></span>}
      {tool.host === null ? null : <span className="hxsh-line" data-host="">{SHARE.label.reaches}: <Cut mono>{tool.host}</Cut></span>}
      {tool.flags.map(flag => <span key={flag} className="hxsh-line" data-flag={flag}><StateDot tone="bad">{FLAG_WORDS[flag]}</StateDot></span>)}
    </li>
  );
}

function SecretRow({ secret }: { secret: ShareSecret }): ReactElement {
  return (
    <li className="hxsh-row" data-secret={secret.name} data-kind={secret.kind}>
      <span className="hxsh-row-head"><Cut mono>{secret.name}</Cut><span className="hxe-muted">{secretKindWords(secret)}</span></span>
      <Capped list={{ rows: secret.sinks, more: 0 }} label={SHARE.label.usedBy} empty={SHARE.hint.noSecrets}
        render={(sink, i) => <li key={`${sink.tool}:${sink.field}:${i}`} className="hxsh-line" data-sink={sink.field}><Cut>{sinkWords(sink)}</Cut></li>} />
    </li>
  );
}

/** The values the file reads from this computer, each with the tool and host it goes to. The Done step of an import draws this list again. */
export function SecretsSection({ summary, side }: { summary: ShareSummary; side: 'export' | 'import' }): ReactElement {
  return (
    <Section title={SHARE.label.secretsHead} count={String(totalOf(summary.secrets))} slot="share-secrets">
      <Capped list={summary.secrets} label={SHARE.label.secretsHead} empty={SHARE.hint.noSecrets} render={(secret, i) => <SecretRow key={`${secret.kind}:${secret.name}:${i}`} secret={secret} />} />
      {totalOf(summary.secrets) === 0 ? null : (
        <>
          <p className="hxe-text hxe-muted">{side === 'import' ? SHARE.hint.secretsImport : SHARE.hint.secretsExport}</p>
          <p className="hxe-text hxe-muted">{SHARE.hint.notChecked}</p>
        </>
      )}
    </Section>
  );
}

/** The counts a bundle holds, each with its name in words. The tools count is the servers; hooks have their own. */
const countRows = (counts: ShareSummary['counts']): readonly (readonly [string, string, number])[] => [
  ['skills', SHARE.label.skills, counts.skills], ['agents', SHARE.label.agents, counts.agents], ['tools', SHARE.label.tools, counts.mcp], ['hooks', SHARE.label.hooks, counts.hooks],
  ['guardrails', SHARE.label.guardrails, counts.guardrails], ['scripts', SHARE.label.scripts, counts.scripts], ['files', SHARE.label.files, counts.files],
];

export interface ShareSummaryViewProps {
  summary: ShareSummary;
  /** `export` lists paths of this computer; `import` lists paths of another one. */
  side: 'export' | 'import';
  /** False when the sheet draws the notes names itself (the import's choices). */
  notes?: boolean;
}

/** What a bundle holds, in the order a person reads it before going on. */
export function ShareSummaryView({ summary, side, notes = true }: ShareSummaryViewProps): ReactElement {
  return (
    <div data-share-summary={side}>
      <Section title={SHARE.label.holds} slot="share-holds">
        <p className="hxe-text"><span className="hxe-muted">{SHARE.label.harness}</span> <Cut mono>{summary.harness}</Cut></p>
        <dl className="hxsh-counts" aria-label={SHARE.label.countsName}>
          {countRows(summary.counts).map(([key, name, n]) => <div key={key} data-count={key}><dt>{name}</dt><dd>{n}</dd></div>)}
          <div data-count="bytes"><dt>{SHARE.label.size}</dt><dd>{fileSizeWords(summary.counts.bytes)}</dd></div>
        </dl>
      </Section>
      <Section title={SHARE.label.toolsHead} count={String(totalOf(summary.tools))} slot="share-tools">
        <Capped list={summary.tools} label={SHARE.label.toolsHead} empty={SHARE.hint.noTools} render={(tool, i) => <ToolRow key={`${tool.kind}:${tool.name}:${i}`} tool={tool} />} />
      </Section>
      <Section title={SHARE.label.codeHead} count={String(totalOf(summary.codeFiles))} slot="share-code">
        <Capped list={summary.codeFiles} label={SHARE.label.codeHead} empty={SHARE.hint.noneRun}
          render={(file, i) => (
            <li key={`${file.path}:${i}`} className="hxsh-row" data-code-file={file.path} data-why={file.why}>
              <Cut mono>{file.path}</Cut>
              <span className="hxe-muted">{CODE_WHY_WORDS[file.why]}</span>
            </li>
          )} />
        {totalOf(summary.codeFiles) === 0 ? null : <p className="hxe-text hxe-muted">{SHARE.hint.codeNote}</p>}
      </Section>
      <SecretsSection summary={summary} side={side} />
      {notes ? (
        <Section title={SHARE.label.notesHead} count={String(totalOf(summary.notes))} slot="share-notes">
          <Capped list={summary.notes} label={SHARE.label.notesHead} empty={SHARE.hint.noNotes}
            render={(note, i) => (
              <li key={`${note.name}:${i}`} className="hxsh-row" data-note={note.name}>
                <Cut>{note.name}</Cut>
                {note.readBy.length === 0 ? null : <span className="hxe-muted">{SHARE.label.readBy}: <Cut>{note.readBy.join(', ')}</Cut></span>}
              </li>
            )} />
          {totalOf(summary.notes) === 0 ? null : <p className="hxe-text hxe-muted">{SHARE.hint.notesOut}</p>}
        </Section>
      ) : null}
      {totalOf(summary.borrowed) === 0 ? null : (
        <Section title={SHARE.label.borrowedHead} count={String(totalOf(summary.borrowed))} slot="share-borrowed">
          <Capped list={summary.borrowed} label={SHARE.label.borrowedHead} empty={SHARE.hint.noBorrowed}
            render={(item, i) => (
              <li key={`${item.name}:${i}`} className="hxsh-row" data-borrowed={item.name}>
                <Cut>{item.name}</Cut>
                <span className="hxe-muted"><Cut>{`${item.marketplace}, ${item.version}`}</Cut></span>
              </li>
            )} />
        </Section>
      )}
      <Section title={side === 'import' ? SHARE.label.pathsOther : SHARE.label.pathsHere} count={String(totalOf(summary.foreignPaths))} slot="share-paths">
        <Capped list={summary.foreignPaths} label={side === 'import' ? SHARE.label.pathsOther : SHARE.label.pathsHere} empty={SHARE.hint.noPaths}
          render={(hit, i) => (
            <li key={`${hit.path}:${hit.line ?? 0}:${i}`} className="hxsh-row" data-foreign-path={hit.path}>
              <span className="hxsh-row-head"><Cut mono>{hit.path}</Cut>{hit.line === null ? null : <span className="hxe-muted">{SHARE.label.line} {hit.line}</span>}</span>
              <span className="hxsh-line"><Cut mono>{hit.text}</Cut></span>
            </li>
          )} />
        {totalOf(summary.foreignPaths) === 0 ? null : <p className="hxe-text hxe-muted">{side === 'import' ? SHARE.hint.pathsImport : SHARE.hint.pathsExport}</p>}
      </Section>
    </div>
  );
}
