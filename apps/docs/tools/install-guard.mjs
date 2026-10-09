// The public beta installs by its dist-tag or exact version, such as bowerloom@beta.
// A bare or latest global install would follow the stable stream, which does not exist yet.
// This finds such an install in prose or code: npm install, npm i or npm add, with -g or --global anywhere
// in the same command, and a bowerloom token with no tag, or with @latest. A command ends at a backtick,
// a line break, or the end of a sentence.
const command = /\bnpm\s+(?:install|i|add)\b([^`\n]*?)(?=`|\n|\.\s|\.$|$)/g;
const bare = /^bowerloom(?:@latest)?[.,;:)]*$/;
export function unsupportedPublicInstalls(text) {
  const found = [];
  for (const match of text.matchAll(command)) {
    const words = match[1].trim().split(/\s+/);
    if (words.some(w => w === '-g' || w === '--global') && words.some(w => bare.test(w))) found.push(match[0].trim());
  }
  return found;
}
