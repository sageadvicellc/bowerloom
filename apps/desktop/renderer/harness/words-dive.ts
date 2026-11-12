/**
 * Words of the dive (v0.9 lane 3): the parts block in the details of a harness, and the "Where it comes from" block in the details of a Library part.
 * Simple English: short sentences, active voice.
 */
export const DIVE = {
  label: { parts: 'Parts', comesFrom: 'Where it comes from' },
  hint: {
    empty: 'This harness holds no parts yet.',
    notListed: 'Not in the Library.',
    missing: 'Not in this harness. It is named, and Bowerloom did not find it.',
    incomplete: 'The scan stopped early or read only part of a folder. This list can be incomplete.',
  },
  unresolved: (id: string): string => `A part named in the manifest (${id === '' ? 'empty id' : id}) was not found.`,
  duplicates: (n: number): string => `${n} ${n === 1 ? 'part id is' : 'part ids are'} used twice in the scan. Bowerloom shows the first part of each.`,
  openPart: (name: string): string => `Open ${name}`,
} as const;
