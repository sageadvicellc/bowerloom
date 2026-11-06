// macOS swaps an app icon by light or dark appearance only from macOS 26, and only for an icon built by Xcode 26. So the bundle carries the light icon
// (build/icon.icns), which Finder and Launchpad show, and while the app runs its Dock icon follows the system appearance: the light or dark PNG from
// build/dock, which electron-builder ships as Resources/dock.
import { join } from 'node:path';

export function dockFolder(o: { readonly packaged: boolean; readonly resourcesPath: string; readonly appRoot: string }): string {
  return o.packaged ? join(o.resourcesPath, 'dock') : join(o.appRoot, '..', 'build', 'dock');
}

export function dockIconFile(folder: string, dark: boolean): string {
  return join(folder, dark ? 'icon-dark.png' : 'icon-light.png');
}

type Dock = { setIcon(image: never): void };
type Theme = { readonly shouldUseDarkColors: boolean; on(event: 'updated', listener: () => void): unknown };
type Image = { isEmpty(): boolean };

/** Sets the Dock icon now and again on every appearance change. An icon that does not load, or any error from the Dock or the theme, is reported and the Dock
 * keeps the bundle icon: it never throws, so it can never stop the app from starting. */
export function followAppearance<I extends Image>(o: { readonly dock: Dock | undefined; readonly theme: Theme; readonly folder: string; readonly load: (path: string) => I; readonly tell?: (message: string) => void }): void {
  const dock = o.dock;
  if (dock === undefined) return;
  const tell = o.tell ?? (message => console.error(message));
  const apply = (): void => {
    try {
      const file = dockIconFile(o.folder, o.theme.shouldUseDarkColors);
      const image = o.load(file);
      if (image.isEmpty()) { tell(`Bowerloom could not load its Dock icon: ${file}`); return; }
      dock.setIcon(image as never);
    } catch (error) { tell(`Bowerloom could not set its Dock icon: ${error instanceof Error ? error.message : String(error)}`); }
  };
  apply();
  try { o.theme.on('updated', apply); } catch (error) { tell(`Bowerloom could not follow the appearance for its Dock icon: ${error instanceof Error ? error.message : String(error)}`); }
}
