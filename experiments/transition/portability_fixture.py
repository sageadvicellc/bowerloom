#!/usr/bin/env python3
"""Disposable portability contract test; NEVER launches a harness or model.

Writes exclusively beneath this file's evidence directory. The mock broker is
not an OS sandbox or a production approval/capacity implementation.
"""
import copy
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
import tomllib

BASE = Path(__file__).resolve().parent
ADAPTER_VERSION = "0.1.0-research-fixture"
HARNESS_VERSIONS = {"codex": "0.157.0", "claude": "2.1.286", "opencode": "1.18.30-receipt-only"}
REQUIRED = ["filesystem.readonly", "tools.network.denied", "structured.result", "skill.required", "approval.exact_revision", "budget.admission", "handoff.artifacts", "state.isolated"]
CAPABILITIES = {h: {c: {"declared": True, "runtime_proven": False, "owner": "supervisor" if c.startswith(("approval", "budget", "handoff", "state")) else "adapter"} for c in REQUIRED} for h in HARNESS_VERSIONS}

def encoded(value):
    return (json.dumps(value, sort_keys=True, indent=2) + "\n").encode()

def digest(value):
    return hashlib.sha256(value).hexdigest()

def safe_path(root, path):
    p = Path(path)
    if p.is_absolute() or ".." in p.parts or "~" in path or not path:
        raise ValueError("nonportable path")
    target = (root / p).resolve()
    if not target.is_relative_to(root.resolve()):
        raise ValueError("path or symlink escapes root")
    return target

def validate(source, root):
    keys = {"schema_version", "id", "crew", "workflow", "controls", "requirements", "evaluation", "extensions"}
    if set(source) != keys or source["schema_version"] != "trellis.portable/v0.1":
        raise ValueError("unknown field or schema version; explicit migration required")
    if source["requirements"] != REQUIRED:
        raise ValueError("fixture control requirement changed")
    for role in source["crew"]:
        for asset in [role["prompt"], *role["skills"]]:
            if digest(safe_path(root, asset["path"]).read_bytes()) != asset["sha256"]:
                raise ValueError("required asset absent or hash mismatch")
    safe_path(root, source["workflow"]["input"])
    safe_path(root, source["evaluation"]["expected"])
    if source["controls"] != CONTROLS:
        raise ValueError("unsupported control semantics in fixture")
    for extension in source["extensions"]:
        if extension.get("required"):
            raise ValueError("unsupported mandatory extension")

CONTROLS = {
    "permissions": {"workspace_files": "read-only", "subprocess_network": "deny", "external_actions": "broker-only"},
    "approvals": {"principal": "hannasage", "bind": ["task_id", "candidate_sha256", "action_id"], "unknown": "deny"},
    "budgets": {"reserve_percent": 25, "max_active_workers": 2, "count_lead": True, "unknown_usage": "deny", "paid_fallback": False, "wall_seconds": 30},
    "state": {"scope": "run-local", "credentials": "external-handle-only", "production_mounts": False},
}

def project(source, root, harness, caps=None):
    validate(source, root)
    caps = caps or CAPABILITIES[harness]
    missing = [c for c in source["requirements"] if not caps.get(c, {}).get("declared")]
    if missing:
        raise ValueError("unsupported mandatory capability: " + ",".join(missing))
    role = source["crew"][0]
    prompt = safe_path(root, role["prompt"]["path"]).read_bytes()
    for skill in role["skills"]:
        prompt += b"\n\nREQUIRED SKILL\n" + safe_path(root, skill["path"]).read_bytes()
    files = {"prompt.md": prompt, "controls.json": encoded(source["controls"]), "result.schema.json": encoded({"type": "object", "required": ["invoice_count", "total_cents"], "additionalProperties": False, "properties": {"invoice_count": {"type": "integer"}, "total_cents": {"type": "integer"}}})}
    if harness == "codex":
        files["config.toml"] = b'default_permissions = "trellis-read"\napproval_policy = "never"\n\n[permissions.trellis-read.filesystem]\n":minimal" = "read"\n\n[permissions.trellis-read.filesystem.":workspace_roots"]\n"." = "read"\n\n[permissions.trellis-read.network]\nenabled = false\n'
        tomllib.loads(files["config.toml"].decode())
        argv = ["codex", "exec", "--strict-config", "--ignore-user-config", "--ignore-rules", "--ephemeral", "--json", "--output-schema", "result.schema.json", "-"]
        config_binding = "Future runner must bind generated config through verified isolated configuration context; argv alone does NOT load config.toml."
    elif harness == "claude":
        files["settings.json"] = encoded({"permissions": {"defaultMode": "dontAsk", "allow": ["Read"], "deny": ["Bash", "PowerShell", "Edit", "Write", "WebFetch", "WebSearch", "Agent"]}})
        argv = ["claude", "--print", "--restricted", "--tools", "Read", "--settings", "settings.json", "--setting-sources", "", "--strict-mcp-config", "--no-session-persistence", "--permission-prompts", "none", "--output-format", "json"]
        config_binding = "settings.json explicit CLI argument; native parse/effective-policy proof still required."
    else:
        files["opencode.json"] = encoded({"$schema": "https://opencode.ai/config.json", "permission": {"*": "deny", "read": "allow", "external_directory": "deny"}, "autoupdate": False, "share": "disabled"})
        argv = ["opencode", "run", "--format", "json"]
        config_binding = "Future runner must bind OPENCODE_CONFIG and suppress inherited/global configuration after version-specific verification."
    launch = {"execute": False, "reason": "research fixture; capability proof and capacity admission absent", "harness": harness, "harness_version": HARNESS_VERSIONS[harness], "adapter_version": ADAPTER_VERSION, "candidate_argv": argv, "config_binding": config_binding, "model_route": None, "state_binding": "provided separately by runtime; no absolute path in portable source", "required_controls": source["requirements"], "compatibility_warnings": [e["namespace"] + ": optional extension not projected" for e in source["extensions"]]}
    files["launch-plan.json"] = encoded(launch)
    manifest = {"schema_version": source["schema_version"], "source_sha256": digest(encoded(source)), "adapter_version": ADAPTER_VERSION, "harness_version": HARNESS_VERSIONS[harness], "files": {p: digest(b) for p, b in sorted(files.items())}}
    files["projection-manifest.json"] = encoded(manifest)
    return files

def materialize(root, files):
    root.mkdir(parents=True, exist_ok=True)
    for name, content in files.items():
        (root / name).write_bytes(content)

def reconcile(root, expected):
    actual = {p.relative_to(root).as_posix(): p.read_bytes() for p in root.rglob("*") if p.is_file()}
    if actual != expected:
        raise ValueError("generated-file drift; explicit reconciliation required")

def admit_live(source, harness, usage):
    if any(not CAPABILITIES[harness][c]["runtime_proven"] for c in source["requirements"]):
        raise ValueError("runtime control proof absent")
    if usage is None:
        raise ValueError("capacity admission absent")
    raise ValueError("live harness execution is out of scope of this fixture")

class Broker:
    """Single-process mock only: not a durable/concurrent transaction engine."""
    def __init__(self, root):
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)
        self.ledger = root / "action-ledger.json"
        if not self.ledger.exists(): self.ledger.write_bytes(encoded({}))

    def apply(self, task_id, candidate, action_id, approval):
        sha = digest(encoded(candidate))
        required = {"principal": "hannasage", "task_id": task_id, "candidate_sha256": sha, "action_id": action_id}
        if approval != required:
            raise ValueError("approval does not match candidate and action")
        ledger = json.loads(self.ledger.read_text())
        if action_id in ledger:
            if ledger[action_id]["candidate_sha256"] != sha: raise ValueError("idempotency collision")
            if ledger[action_id]["status"] == "ambiguous": raise ValueError("human reconciliation required")
            return "already-committed"
        safe_path(self.root, "accepted-summary.json").write_bytes(encoded(candidate))
        ledger[action_id] = {"status": "committed", "candidate_sha256": sha}
        self.ledger.write_bytes(encoded(ledger))
        return "committed"

def run():
    started = time.monotonic()
    root = Path(tempfile.mkdtemp(prefix="run-", dir=BASE))
    repo = root / "portable-repo"
    (repo / "prompts").mkdir(parents=True)
    (repo / "skills").mkdir()
    (repo / "fixtures").mkdir()
    (repo / "prompts" / "analyst.md").write_text("Read the synthetic invoice fixture. Return count and sum of cents. Propose the result; the broker owns publication.\n")
    (repo / "skills" / "sum-invoices.md").write_text("Use integer cents. Include every invoice once. Never invent missing values.\n")
    invoices = [{"invoice": "syn-001", "cents": 1200}, {"invoice": "syn-002", "cents": 3400}]
    (repo / "fixtures" / "invoices.json").write_bytes(encoded(invoices))
    expected = {"invoice_count": 2, "total_cents": 4600}
    (repo / "fixtures" / "expected.json").write_bytes(encoded(expected))
    asset = lambda p: {"path": p, "sha256": digest((repo / p).read_bytes())}
    source = {"schema_version": "trellis.portable/v0.1", "id": "synthetic-invoice-summary", "crew": [{"id": "analyst", "prompt": asset("prompts/analyst.md"), "skills": [asset("skills/sum-invoices.md")]}], "workflow": {"input": "fixtures/invoices.json", "steps": [{"id": "summarize", "role": "analyst", "after": []}, {"id": "approve", "role": "founder", "after": ["summarize"]}, {"id": "publish", "role": "broker", "after": ["approve"]}]}, "controls": copy.deepcopy(CONTROLS), "requirements": REQUIRED, "evaluation": {"expected": "fixtures/expected.json", "method": "exact-json"}, "extensions": []}
    (repo / "trellis.json").write_bytes(encoded(source))
    mappings = {"adapter_version": ADAPTER_VERSION, "routes": {h: {"harness_version": v, "model": None, "subscription_access": "unverified"} for h, v in HARNESS_VERSIONS.items()}}
    (repo / "adapters.lock.json").write_bytes(encoded(mappings))
    commands = []
    def git(args, cwd):
        argv = ["git", *args]
        proc = subprocess.run(argv, cwd=cwd, text=True, capture_output=True, check=True, timeout=10, env={**os.environ, "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": "/dev/null", "GIT_TERMINAL_PROMPT": "0"})
        commands.append({"argv": argv, "cwd": str(cwd), "stdout": proc.stdout, "stderr": proc.stderr, "returncode": proc.returncode})
        return proc.stdout.strip()
    git(["init", "--initial-branch=fixture"], repo)
    git(["add", "."], repo)
    git(["-c", "user.name=Trellis fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "commit", "-m", "Freeze portable synthetic input"], repo)
    revision = git(["rev-parse", "HEAD"], repo)
    clone = root / "clean-clone"
    git(["clone", "--local", str(repo), str(clone)], root)
    tests = []
    def check(name, fn):
        begin = time.monotonic()
        try:
            detail = fn()
            tests.append({"name": name, "status": "PASS", "seconds": round(time.monotonic()-begin, 6), "detail": detail})
        except Exception as e:
            tests.append({"name": name, "status": "FAIL", "error": repr(e)})
    def must_reject(fn):
        try: fn()
        except (ValueError, FileNotFoundError) as e: return str(e)
        raise AssertionError("unexpected acceptance")
    def equal(a,b):
        assert a == b
        return "equal"
    original_source = (repo / "trellis.json").read_bytes()
    for harness in HARNESS_VERSIONS:
        files = project(source, repo, harness)
        projected = root / "projections" / harness
        materialize(projected, files)
        check(harness+": deterministic projection after clean clone", lambda h=harness,f=files: equal(project(source, clone,h), f))
        check(harness+": controls preserved exactly", lambda f=files: equal(json.loads(f["controls.json"]), CONTROLS))
        caps = copy.deepcopy(CAPABILITIES[harness]);del caps["budget.admission"]
        check(harness+": missing mandatory capability rejected",lambda h=harness,c=caps: must_reject(lambda: project(source,repo,h,c)))
        (projected / "prompt.md").write_text("drift")
        check(harness+": generated file edit detected",lambda p=projected,f=files: must_reject(lambda: reconcile(p,f)))
        materialize(projected,files)
        check(harness+": live admission blocked without runtime proof",lambda h=harness: must_reject(lambda: admit_live(source,h,None)))
    check("harness mapping leaves business definition unchanged",lambda: equal((repo/"trellis.json").read_bytes(),original_source))
    bad=copy.deepcopy(source);bad["unrecognized_permissions"]={"allow":"all"}
    check("unknown core field rejected",lambda:must_reject(lambda:project(bad,repo,"codex")))
    badversion=copy.deepcopy(source);badversion["schema_version"]="trellis.portable/v99"
    check("unknown schema requires migration",lambda:must_reject(lambda:project(badversion,repo,"codex")))
    badasset=copy.deepcopy(source);badasset["crew"][0]["skills"][0]["sha256"]="0"*64
    check("required skill hash mismatch rejected",lambda:must_reject(lambda:project(badasset,repo,"claude")))
    extension=copy.deepcopy(source);extension["extensions"]=[{"namespace":"claude.background", "required":True}]
    check("unsupported mandatory extension rejected",lambda:must_reject(lambda:project(extension,repo,"codex")))
    optional=copy.deepcopy(source);optional["extensions"]=[{"namespace":"claude.background","required":False}]
    check("optional extension reports compatibility loss",lambda:equal(len(json.loads(project(optional,repo,"codex")["launch-plan.json"])["compatibility_warnings"]),1))
    check("path traversal rejected",lambda:must_reject(lambda:safe_path(repo,"../private")))
    check("absolute path rejected",lambda:must_reject(lambda:safe_path(repo,"/private")))
    (repo/"escape-link").symlink_to(root)
    check("symlink escape rejected",lambda:must_reject(lambda:safe_path(repo,"escape-link/private")))
    (repo/"escape-link").unlink()
    # Both mock candidates use the same deterministic arithmetic, not a model.
    candidates={h:{"invoice_count":len(invoices),"total_cents":sum(i["cents"] for i in invoices)} for h in ["codex","claude"]}
    for h,candidate in candidates.items():
        check(h+": synthetic workflow acceptance (mock only)",lambda c=candidate:equal(c,expected))
    state=root/"state-a";broker=Broker(state)
    sha=digest(encoded(expected));approval={"principal":"hannasage","task_id":source["id"],"candidate_sha256":sha,"action_id":"publish-syn-001"}
    check("missing approval rejected",lambda:must_reject(lambda:broker.apply(source["id"],expected,"publish-syn-001",{})))
    stale={**approval,"candidate_sha256":"0"*64}
    check("stale approval rejected",lambda:must_reject(lambda:broker.apply(source["id"],expected,"publish-syn-001",stale)))
    check("matching synthetic approval permits mock broker action",lambda:equal(broker.apply(source["id"],expected,"publish-syn-001",approval),"committed"))
    handoff={"schema":"trellis.handoff/v0.1","task_id":source["id"],"source_sha256":digest(original_source),"completed_steps":["summarize","approve","publish"],"next_step":"evaluate","source_harness":"codex-mock","target_harness":"claude-mock","candidate":expected,"action_ledger":json.loads(broker.ledger.read_text()),"artifacts":{"accepted-summary.json":digest((state/"accepted-summary.json").read_bytes())},"approval":approval,"native_session_state":None}
    (root/"handoff.json").write_bytes(encoded(handoff))
    resumed=Broker(root/"state-b")
    resumed.ledger.write_bytes(encoded(json.loads((root/"handoff.json").read_text())["action_ledger"]))
    check("cross-harness artifact handoff avoids repeated committed action (mock)",lambda:equal(resumed.apply(source["id"],expected,"publish-syn-001",approval),"already-committed"))
    ledger=json.loads(resumed.ledger.read_text());ledger["publish-syn-001"]["status"]="ambiguous";resumed.ledger.write_bytes(encoded(ledger))
    check("ambiguous action blocks replay",lambda:must_reject(lambda:resumed.apply(source["id"],expected,"publish-syn-001",approval)))
    production=root/"production-sentinel";production.mkdir();(production/"state.txt").write_text("synthetic production marker\n")
    before=(production/"state.txt").read_bytes();broker.ledger.write_bytes(broker.ledger.read_bytes())
    check("separate fixture state leaves production sentinel unchanged",lambda:equal((production/"state.txt").read_bytes(),before))
    check("clean clone contains no private harness directories",lambda:equal(any((clone/p).exists() for p in [".codex",".claude",".config"]),False))
    summary={"observed_at":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime()),"fixture_version":ADAPTER_VERSION,"fixture_sha256":digest(Path(__file__).read_bytes()),"root":str(root),"portable_git_revision":revision,"portable_sha256":digest(original_source),"tests":tests,"passed":sum(t["status"]=="PASS" for t in tests),"failed":sum(t["status"]=="FAIL" for t in tests),"elapsed_seconds":round(time.monotonic()-started,4),"actual_harness_sessions":0,"model_calls":0,"runtime_permission_proof":False,"runtime_isolation_proof":False,"budget_enforcement_proof":False,"limitations":["No native configuration load or native tool denial tested", "Single-process ledger; crash atomicity and concurrent ownership not tested", "Separate directories are not an OS isolation boundary", "No credential store read, copied, or changed", "No actual capacity admission exercised; external capacity contract remains required"]}
    (root/"commands.json").write_bytes(encoded(commands));(root/"results.json").write_bytes(encoded(summary))
    (BASE/"latest-results.json").write_bytes(encoded(summary))
    print(json.dumps({k:summary[k] for k in ["root","passed","failed","elapsed_seconds","portable_git_revision","actual_harness_sessions","runtime_permission_proof"]},indent=2))
    if summary["failed"]:raise SystemExit(1)

if __name__=="__main__":run()
