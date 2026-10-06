export function copyFeedback(kind,succeeded) {
  if(!['prompt','procedure','page Markdown'].includes(kind))throw new Error('Unknown copy block.');
  return succeeded ? `Copied ${kind}.` : `Could not copy ${kind}. Select the text or open Markdown.`;
}
