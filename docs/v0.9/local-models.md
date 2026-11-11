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

These are probed without any file. A default that does not answer is left out of the report, so you do not see a wall of "down".

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
- `PARTIAL_READ`: the server answered, but at least one of `/props`, `/slots`, `/v1/models` or `/metrics` failed. Some figures could not be read. A 404 or 501 is not a failure: it means the server switched that endpoint off.
- `NO_ENDPOINTS`: no local server answered.
- `CONFIG_UNREADABLE`: the ports file could not be read.
- `ENDPOINT_REFUSED_*`, `TOO_MANY_ENDPOINTS`: an entry in the ports file was left out.

A figure the server did not give is shown as "not reported". It is never shown as 0.

## Not reported yet

Process memory and uptime are "not reported" until a later PR. This version reads no process.
