"""Replay research fixtures in disposable storage outside the checkout."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

source = Path(__file__).resolve().parent
manifest = json.loads((source / "source-manifest.json").read_text())
for entry in manifest["files"]:
    if hashlib.sha256((source / entry["file"]).read_bytes()).hexdigest() != entry["sha256"]:
        raise SystemExit("Research source changed: " + entry["file"])

cases = [
    ("admission_experiment.py", 45),
    ("contract_fixture.py", 52),
    ("portability_fixture.py", 33),
    ("failure_fixture.py", 15),
    ("repository_shape_model.py", 14),
]
results = []
fixture_environment = dict(os.environ)
fixture_environment.pop("PYTHONOPTIMIZE", None)
with tempfile.TemporaryDirectory(prefix="trellis-research-") as scratch:
    root = Path(scratch)
    for filename, expected in cases:
        directory = root / Path(filename).stem
        directory.mkdir()
        script = directory / filename
        shutil.copyfile(source / filename, script)
        command = [sys.executable, str(script)]
        if filename == "failure_fixture.py":
            command += ["--output", str(directory / "run")]
        completed = subprocess.run(command, cwd=directory, env=fixture_environment,
                                   capture_output=True, text=True, timeout=30)
        if completed.returncode:
            raise SystemExit(filename + " failed: " + completed.stderr)
        result = json.loads(completed.stdout)
        summary = result.get("summary", result)
        if summary.get("passed") != expected or summary.get("failed", 0) != 0:
            raise SystemExit(filename + " did not match the recorded result.")
        results.append({"fixture": filename, "passed": summary["passed"]})
print(json.dumps({"scope": "synthetic research only", "fixtures": results,
                  "model_calls": 0, "production_runtime_tested": False}, indent=2))
