/** The width of the window in pixels, kept up to date as the window is resized. A page drawn without a window (the tests that render to markup) is 1280 wide. */
import { useEffect, useState } from 'react';

export function useWindowWidth(): number {
  const [width, setWidth] = useState(() => (typeof window === 'undefined' ? 1280 : window.innerWidth));
  useEffect(() => {
    const read = (): void => setWidth(window.innerWidth);
    read();
    window.addEventListener('resize', read);
    return () => window.removeEventListener('resize', read);
  }, []);
  return width;
}
