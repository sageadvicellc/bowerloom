# Local models

The `local-models` package shows which model servers run on this computer. It only reads. It never starts, stops or changes a server.

## What it reads

It sends GET requests to `127.0.0.1` and nothing else. For a llama-server it reads `/health`, `/props`, `/slots`, `/metrics` and `/v1/models`. It keeps a short list of fields: the model name and file, quantization, parameter count, file size, context size, slot count, request counts and token speeds. It never reads a prompt, an answer or a chat template.

A model name and a model file are shown by their last part only. A folder never shows.

A request has a time limit of 800 ms, a size limit by path, and follows no redirect. No proxy is used, even when a proxy setting is present in the environment.

## The ports file

The file is `local-models.json` in the state folder:

```json
{ "endpoints": [{ "provider": "llama-server", "port": 8091 }] }
```

Rules:

- The host is always `127.0.0.1`. An entry that names another host is left out, with a note.
- Any local port you list is probed with a GET. Only list a port you trust.
- A port is a whole number from 1 to 65535. A bad entry is left out, with a note.
- Up to 8 endpoints are probed. The file is read again at each probe, and the package never writes it.
- An unreadable file means no server is probed, and a note says so.

## The three default ports

These are probed without any file. A default that does not answer is left out of the report, so you do not see a wall of "down". This is by design: an unreachable default endpoint is dropped silently, and only a port you wrote in the file shows as down, unreachable or unsupported.

- llama-server: 8080
- Ollama: 11434
- LM Studio: 1234

Only llama-server can be read in this version. The other two show as unsupported when they answer.

## Row states

- `up`: the server answered and is ready.
- `starting`: the server is loading a model.
- `down`: nothing listens on the port, or the connection was refused.
- `unreachable`: the connection failed or timed out.
- `unsupported`: something answered, but not in a form this package reads.

A row that is not `up` carries a short reason code, such as `CONNECTION_REFUSED`, `TIMEOUT` or `BAD_RESPONSE`.

## Notes

- `METRICS_OFF`: the server runs without metrics, so request and speed figures are not reported.
- `METRICS_UNREADABLE`: `/metrics` answered 200, but none of the figures asked for were in it. A 404 or 501 is `METRICS_OFF` instead.
- `PARTIAL_READ`: the server answered, but at least one of `/props`, `/slots`, `/v1/models` or `/metrics` failed, or answered 200 with a body that could not be read or lacked its expected key. Some figures could not be read. A 404 or 501 is not a failure: it means the server switched that endpoint off.
- `NO_ENDPOINTS`: no local server answered.
- `CONFIG_UNREADABLE`: the ports file could not be read. Its `reason` is `PARSE` (not JSON), `SHAPE` (wrong form), `TOO_LARGE`, `NOT_FILE` (a folder, a link, or a path through a file) or `IO` (any other read error).
- `PROBE_FAILED`: the whole probe failed. Its `reason` is the error class, such as `TYPE_ERROR` or `ERROR`. The message is never kept.
- `ENDPOINT_REFUSED_*`, `TOO_MANY_ENDPOINTS`: an entry in the ports file was left out.

The report-level `notes` list holds each code once. Each model row also has its own `notes`: the codes that apply to that row (`PARTIAL_READ`, `METRICS_OFF`, `METRICS_UNREADABLE`), each with the `paths` that caused it, taken from a fixed list. No response text is kept.

A figure the server did not give is shown as "not reported". It is never shown as 0.

## The screen

Local models is a bundled UI extension. Its manifest is `apps/desktop/extensions/local-models/manifest.json`. It is not protected, and it ships in the app resources.

- The screen follows `listExtensions`. If main did not load the extension, the route and the navigation entry do not exist. If the call fails at launch, before the extension host starts, the screen waits and asks again every 3 seconds. It shows no error.
- The screen asks `localModels` every 3 seconds while the window is visible. It also has a Refresh button. It stores nothing.
- One row for each server: state, model file name, quantization, size, context size, speed, requests, context use and port. Memory and uptime read "not reported".
- A server that is down, starting or not answering is a row with a state and a sentence. A figure that is missing reads "not reported", never 0.
- A note such as `PARTIAL_READ` shows as its sentence. A row shows its own notes too, when the report has them.
- If the probe itself failed (`PROBE_FAILED`), the report has no rows and a count of 0. The screen shows the note's sentence. It does not say "no servers are set up", and it shows no count.
- If the last read failed, the screen keeps the last figures and says they are old. After 10 seconds without a good read they are marked old too.
- The sample launch shows made-up servers and says so.
- All display logic is in `apps/desktop/shared/local-models/view-model.ts`. A terminal view can use it.

## Not reported yet

Process memory and uptime are "not reported" until a later PR. This version reads no process.
