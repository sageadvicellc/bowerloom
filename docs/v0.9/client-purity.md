# Client purity

Lane L4d of the 0.9 scope. Only Bowerloom's own surfaces call the engine API. A screen of the desktop renderer reaches the engine only through the engine API client (`apps/desktop/renderer/api/client.ts`).

Terms. The engine API is the 42 calls of the app window: 3 reader calls and 39 engine calls. The client is the one module that checks what the window holds and hands the calls down. The transport (`renderer/api/transport.ts`) is the one file that reads the window.

## What the check does

`apps/desktop/tests/renderer-client-purity.test.ts` reads every source file of `apps/desktop/renderer/`. The rules are in `apps/desktop/tests/helpers-engine/client-purity.ts`.

Any of these things fails a file.

- It imports a Node module, Electron, or a file outside `renderer/` and `shared/`. Type-only imports count too.
- It imports a module of `shared/engine` or `shared/real` that is not on the pure list. The pure list holds types, constants and pure helpers.
- It imports the transport, and it is not the client.
- It imports the sample engine, and it is not the client.
- It imports `getApiClient` or `createApiClient`, and it is not the page entry.
- It names `bowerloomReal` or `bowerloomEngine`. It reads a `window.bowerloom*` member. It names a `bowerloom-real:` or `bowerloom-engine:` channel.
- It uses `ipcRenderer`, `contextBridge`, `require` or `process`. It calls a file or process function. It uses the network, `eval` or a dynamic import.
- It asks main for something outside the engine API: `window.close`, a new page title, or a `beforeunload` listener.

The test also proves that each rule can fail. It feeds the rules bad files.

## The allowances

There are four. Each has its reason in the test file.

- The transport names the two bridges, by design.
- The close button of the no-bridge screen calls `window.close`.
- The close guard sets the page title and listens for `beforeunload` (owner decision Q1A). Each has its own allowance.

The last two entries are side channels to main that no engine call carries. A new engine call for them changes the frozen contract. That is a decision for the maintainer, so this lane does not make it.

## Related checks that were already there

`tests/real-static.test.ts` holds the whole page graph to the rules of a page. `tests/api-call-layer.test.ts` holds the call list and the one reader of the window. `tests/harness-boundary.test.ts` holds the preview folders. The new check adds the engine imports, the channel names, the type-only imports and the side channels.
