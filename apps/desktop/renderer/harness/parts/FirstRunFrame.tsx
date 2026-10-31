/** The page of the three first screens (Welcome, Choose sources, Read sources): no navigation, one centered column on the page colour. The heading of the screen is its `h1`. */
import type { ReactElement, ReactNode } from 'react';
import '../../home/home-tokens.css';
import '../../home/kit/kit.css';
import '../../home/home.css';
import '../harness.css';

export function FirstRunFrame({ children, slot }: { children?: ReactNode; slot: string }): ReactElement {
  return (
    <div className="hx-first" data-home="" data-screen={slot}>
      <main id="main" className="hx-first-main">{children}</main>
    </div>
  );
}
