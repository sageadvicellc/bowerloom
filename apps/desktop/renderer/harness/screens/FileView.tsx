/**
 * S4, the File view: one file, read only. The top row says "Read-only". The page holds the file's path behind "Show details", a note about secrets, where it works, the front matter as labelled fields,
 * and the raw text. The text is the person's own and is drawn as plain text, never as markup. Back goes to the page the person came from.
 */
import type { ReactElement } from 'react';
import { fieldLabel, fieldValue, fileNameOf, parseFrontMatter } from '../../../shared/harness/frontmatter.js';
import { partById, worksIn } from '../../../shared/harness/status.js';
import { Screen } from '../Screen.js';
import { go } from '../router.js';
import { useHarnessState } from '../session.js';
import { HButton, StateDot } from '../parts/controls.js';
import { WORDS } from '../words.js';
import { PathDisclosure } from '../parts/PathDisclosure.js';
import { NotChecked } from '../real/NotChecked.js';

export function FileView({ partId }: { partId: string }): ReactElement {
  const state = useHarnessState();
  const part = partById(state, partId);
  const back = (): void => { if (history.length > 1) history.back(); else go({ name: 'harnesses' }); };
  if (part === undefined) {
    return (
      <Screen slot="file" title={WORDS.label.file}>
        <p className="kit-hint hx-hint">{WORDS.hint.noFile}</p>
        <div className="hx-actions"><HButton icon="back" onClick={back}>{WORDS.label.back}</HButton></div>
      </Screen>
    );
  }
  const parsed = parseFrontMatter(part.fileText);
  return (
    <Screen slot="file" title={fileNameOf(part.path)} titleExtra={<StateDot tone="quiet" className="hx-title-state">{WORDS.hint.readOnly}</StateDot>} tools={<HButton icon="back" variant="text" onClick={back}>{WORDS.label.back}</HButton>}>
      <div className="hx-file">
        <PathDisclosure path={part.path} subject={fileNameOf(part.path)} key={part.id} />
        <p className="hx-text hx-muted" data-budget="paragraph">{WORDS.paragraph.fileNote}</p>
        <div className="hx-usedby"><strong>{WORDS.label.usedBy}</strong>{state.real === undefined ? <ul className="hx-inline-list">{worksIn(state, part).map(i => <li key={i.id}><StateDot tone="good">{i.name}</StateDot></li>)}</ul> : <NotChecked part={part} />}</div>
        <div className="hx-file-cols">
          <section className="hx-card" aria-labelledby="hx-fm">
            <h2 className="hx-card-title" id="hx-fm">{WORDS.label.frontMatter}</h2>
            {parsed.found ? (
              <dl className="hx-fields">
                {parsed.fields.map(field => (
                  <div key={field.key} className="hx-field"><dt>{fieldLabel(field.key)}</dt><dd>{fieldValue(field.key, field.value)}</dd></div>
                ))}
              </dl>
            ) : <p className="hx-text hx-muted">{WORDS.label.noFrontMatter}</p>}
          </section>
          <section className="hx-card hx-card-raw" aria-labelledby="hx-raw">
            <h2 className="hx-card-title" id="hx-raw">{WORDS.label.rawFile}</h2>
            <pre className="hx-raw" data-budget="content">{part.fileText}</pre>
          </section>
        </div>
      </div>
    </Screen>
  );
}
