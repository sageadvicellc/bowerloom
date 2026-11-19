// Helpers of the specs: click a button of the test page and wait for the text it writes.
/**
 * The app is started once for the run, and its page keeps its state from one spec file to the next (the service reuses the window). So each spec loads the page again
 * first, which clears every output field and starts a new core. Without it, a spec can read the text an earlier spec left behind.
 */
export async function ready() {
  await browser.refresh();
  const status = await browser.$('#status');
  await browser.waitUntil(async () => (await status.getText()) === 'ready', { timeout: 30000, timeoutMsg: 'the core did not become ready' });
}

export async function click(id) {
  await (await browser.$(`#${id}`)).click();
}

export async function textOf(id) {
  return (await browser.$(`#${id}`)).getText();
}

/** Clicks the button and waits until its output field holds text that matches. Returns the text. */
export async function press(button, output, pattern) {
  await click(button);
  await browser.waitUntil(async () => pattern.test(await textOf(output)), { timeout: 30000, timeoutMsg: `${output} never matched ${pattern}: "${await textOf(output)}"` });
  return textOf(output);
}
