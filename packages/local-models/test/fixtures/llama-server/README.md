# llama-server fixtures

`example-9b/` and `gpt-oss-20b/` hold real responses of two llama-server 0.9.0 (build b12110) instances, read with GET on 127.0.0.1: /health, /props, /slots, /metrics and /v1/models.
The model name of the first server is replaced by `Example-9B`, because the real name is private to one machine. Nothing else was changed.
Only allow-listed fields were kept. /props keeps no chat template, no token text and no generation settings. /slots keeps `id`, `n_ctx`, `speculative` and `is_processing`.
/v1/models keeps the id and the five `meta` numbers and words. Model files are named by file only, as the servers reported them. Both servers were idle, so every counter is 0.

`derived/` holds files made by hand from those, because an idle server shows nothing busy. They are not recordings:
- `metrics-busy.txt`: the Example 9B metrics with busy numbers.
- `slots-busy-sentinel.json`: the Example 9B slots with slot 0 busy, carrying a sentinel string in every place a real server could put prompt or output text. The tests assert the sentinel never reaches a report.
- `health-loading.json`: the 503 body of a server that is still loading its model.
