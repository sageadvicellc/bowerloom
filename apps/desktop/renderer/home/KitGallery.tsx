/**
 * The kit gallery, at the address #prototype-v2/kit: every part of the card kit in every state, in a light and a dark look side by side. It is for review
 * and screenshots only; nothing in the app links to it. The states that need a pointer or the keyboard (hover, focus) are drawn with `demo`.
 */
import type { ReactElement, ReactNode } from 'react';
import { CARD_WORDS, agentTitle } from '../../shared/home/cards.js';
import type { CardBadge, ShelfEntry } from '../../shared/home/cards.js';
import { Avatar } from './kit/Avatar.js';
import { Badge } from './kit/Badge.js';
import { Button } from './kit/Button.js';
import { Drawer } from './kit/Drawer.js';
import { HelpPopover } from './kit/HelpPopover.js';
import { ItemCard } from './kit/ItemCard.js';
import { Shelf } from './kit/Shelf.js';
import { WORDS } from './words.js';
import './home-tokens.css';
import './kit/kit.css';
import './home.css';

const L = WORDS.label;
const none = (): void => undefined;
const copies: CardBadge = { label: `2 ${CARD_WORDS.copiesSuffix}`, tone: 'warn' };
const needsKey: CardBadge = { label: L.needsKeyBadge, tone: 'warn' };
const fresh: CardBadge = { label: L.newBadge, tone: 'new' };
const AVATAR_NAMES = ['Velvet Weaver', 'Brisk Archivist', 'Sunlit Cartographer', 'Quiet Warden', 'Humble Scribe', 'Mellow Cooper', 'Wintry Navigator', 'Ember Forager'];
const entry = (id: string, kind: ShelfEntry['kind'], name: string, badge?: CardBadge): ShelfEntry => ({ id, kind, name, ...(badge === undefined ? {} : { badge }) });
const SHELF: ShelfEntry[] = [entry('s1', 'skill', 'Weekly Review', copies), entry('s2', 'skill', 'Meeting Notes'), entry('s3', 'skill', 'Draft Reply', fresh)];
const LONG_SHELF: ShelfEntry[] = Array.from({ length: 11 }, (_, i) => entry(`l${i}`, 'skill', `Skill Number ${i + 1}`, i === 2 ? copies : undefined));

function Cell({ caption, children }: { caption: string; children: ReactNode }): ReactElement {
  return <div className="hm-gallery-cell">{children}<p className="kit-hint">{caption}</p></div>;
}
function Block({ title, children }: { title: string; children: ReactNode }): ReactElement {
  return <section className="hm-gallery-block"><h3 className="kit-heading">{title}</h3><div className="hm-gallery-row">{children}</div></section>;
}

function Look({ theme, title }: { theme: 'light' | 'dark'; title: string }): ReactElement {
  const sample = agentTitle('velvet-weaver'), hint = WORDS.hint.sampleAgent;
  return (
    <section className="hm-gallery-theme" data-home="" data-theme={theme} aria-label={title}>
      <h2 className="kit-heading">{title}</h2>
      <Block title={L.galleryCards}>
        <Cell caption={L.galleryNormal}><ItemCard kind="agent" name={sample} hint={hint} selected={false} onSelect={none} /></Cell>
        <Cell caption={L.galleryHover}><ItemCard kind="agent" name={sample} hint={hint} selected={false} onSelect={none} demo="hover" /></Cell>
        <Cell caption={L.gallerySelected}><ItemCard kind="agent" name={sample} hint={hint} selected onSelect={none} /></Cell>
        <Cell caption={L.galleryFocus}><ItemCard kind="agent" name={sample} hint={hint} selected={false} onSelect={none} demo="focus" /></Cell>
        <Cell caption={L.galleryBadge}><ItemCard kind="agent" name={L.sampleLongName} hint={hint} badge={fresh} selected={false} onSelect={none} /></Cell>
      </Block>
      <Block title={L.galleryCards}>
        <Cell caption={L.gallerySkill}><ItemCard kind="skill" name={L.sampleSkill} selected={false} onSelect={none} /></Cell>
        <Cell caption={L.gallerySelected}><ItemCard kind="skill" name={L.sampleSkill} selected onSelect={none} /></Cell>
        <Cell caption={L.galleryBadge}><ItemCard kind="skill" name={L.sampleSkill} badge={copies} selected={false} onSelect={none} onBadgePress={none} /></Cell>
        <Cell caption={L.galleryTool}><ItemCard kind="tool" name={L.sampleTool} badge={needsKey} selected={false} onSelect={none} /></Cell>
        <Cell caption={L.galleryNote}><ItemCard kind="note" name={L.sampleNote} selected={false} onSelect={none} /></Cell>
        <Cell caption={L.galleryHover}><ItemCard kind="note" name={L.sampleNote} selected={false} onSelect={none} demo="hover" /></Cell>
        <Cell caption={L.galleryFocus}><ItemCard kind="tool" name={L.sampleTool} selected={false} onSelect={none} demo="focus" /></Cell>
        <Cell caption={L.galleryBadge}><ItemCard kind="skill" name={L.sampleLongName} badge={fresh} selected={false} onSelect={none} /></Cell>
      </Block>
      <Block title={L.galleryBadges}>
        <Badge badge={copies} onPress={none} /><Badge badge={needsKey} /><Badge badge={fresh} /><Badge badge={{ label: L.selected, tone: 'info' }} />
      </Block>
      <Block title={L.galleryButtons}>
        <Cell caption={L.galleryPrimary}><Button variant="primary" icon="plus">{L.add}</Button></Cell>
        <Cell caption={L.galleryQuiet}><Button icon="clock">{L.savePoints}</Button></Cell>
        <Cell caption={L.galleryDisabled}><Button variant="primary" disabled>{L.save}</Button></Cell>
        <Cell caption={L.help}><Button round aria-label={L.help}>?</Button></Cell>
      </Block>
      <Block title={L.galleryAvatars}>
        {AVATAR_NAMES.map(name => <Avatar key={name} name={name} />)}
        <Avatar name="" /><Avatar name={AVATAR_NAMES[0]!} size="small" />
      </Block>
      <Block title={L.galleryShelf}>
        <Shelf title={L.skills} entries={SHELF} selectedId="s2" onSelect={none} emptyText={WORDS.hint.emptyShelf} level={4} />
        <Shelf title={L.notes} entries={[]} selectedId={null} onSelect={none} emptyText={WORDS.hint.emptyShelf} level={4} />
        <Shelf title={L.galleryLongShelf} entries={LONG_SHELF} selectedId={null} onSelect={none} emptyText={WORDS.hint.emptyShelf} level={4} />
      </Block>
      <Block title={L.galleryHelp}>
        <div className="hm-gallery-popover-room"><HelpPopover label={L.help} text={WORDS.popover.savePoint} defaultOpen /></div>
        <HelpPopover label={L.help} text={WORDS.popover.connection} />
      </Block>
      <Block title={L.galleryDrawer}>
        <Drawer open inline level={4} title={L.addDrawer} onClose={none}><p className="kit-hint">{WORDS.hint.galleryDrawerBody}</p></Drawer>
      </Block>
    </section>
  );
}

export function KitGallery(): ReactElement {
  return (
    <main id="main" className="hm-gallery-page" data-home="">
      <div className="hm-gallery-intro">
        <h1 className="kit-heading" tabIndex={-1}>{L.gallery}</h1>
        <p className="kit-hint">{WORDS.hint.galleryIntro}</p>
      </div>
      <div className="hm-gallery-themes">
        <Look theme="light" title={L.galleryLight} />
        <Look theme="dark" title={L.galleryDark} />
      </div>
    </main>
  );
}
