/**
 * The error listener of stderr. A write to a closed stderr (a parent that went away) is an async EPIPE; without a listener it would crash main. EPIPE is ignored, because
 * nothing can be logged. Any other code is tried once on the console, inside a try/catch, and then ignored: the app goes on either way.
 */
export function stderrErrorHandler(report: (text: string) => void = text => { console.error(text); }): (error: Error) => void {
  return (error: Error): void => {
    const code = (error as { code?: unknown }).code;
    if (code === 'EPIPE') return;
    try { report(`Bowerloom: stderr failed (${typeof code === 'string' ? code : error.message}).`); } catch { /* the console failed too; the app goes on */ }
  };
}
