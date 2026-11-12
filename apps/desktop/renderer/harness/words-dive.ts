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
  },
  openPart: (name: string): string => `Open ${name}`,
} as const;
