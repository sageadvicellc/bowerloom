export const PROTOTYPE_PREFIX: 'bowerloom-prototype-';
export function userDataArg(argv: readonly string[]): string | null;
export function isPrototypeDataPath(dir: string, tmp: string): boolean;
export function chooseUserData(arg: string | null, tmp: string): { readonly action: 'keep'; readonly dir: string } | { readonly action: 'make' };
export function mayRemovePrototypeDir(dir: string, facts: { readonly isSymbolicLink: boolean; readonly isDirectory: boolean; readonly realParent: string; readonly realTmp: string }): boolean;
export function makePrototypeDataDir(tmp?: string): string;
export function removePrototypeDataDir(dir: string, tmp?: string): boolean;
