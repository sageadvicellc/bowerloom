/**
 * Beta.1, demo mode: the sample world locks the preview engines (OpenCode, Pi, DeepSeek Harness) like the real app does. The e2e specs that install to OpenCode
 * start the sample launch with `--sample-preview-engines`. Only main reads that argument, and only for the sample launch (`--sample`, never the launch on
 * the person's own folders). Main then adds one attribute to the body of the page it serves. The page reads it once, to make its sample world, and has no way
 * to set it: the page gets no bridge in this mode, and the environment is not read. A normal demo launch has no such argument, so the attribute is never there.
 */
export const SAMPLE_PREVIEW_FLAG = '--sample-preview-engines';
export const SAMPLE_PREVIEW_ATTRIBUTE = 'data-sample-preview-engines';

/** The page with the attribute on its body when `on`, else the page as it is. A page with no plain `<body>` tag, or with the attribute already, is left as it is. */
export function withSamplePreviewEngines(html: string, on: boolean): string {
  if (!on || html.includes(SAMPLE_PREVIEW_ATTRIBUTE)) return html;
  return html.replace('<body>', `<body ${SAMPLE_PREVIEW_ATTRIBUTE}="1">`);
}
