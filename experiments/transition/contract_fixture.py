"""Research-only composition stubs. No harness, network, or production module runs."""
from __future__ import annotations

import copy
import hashlib
import json
import math
from pathlib import Path
import tempfile
import time

HERE = Path(__file__).resolve().parent
CAPABILITIES = {"artifacts", "exact-approval", "cancel", "handoff", "team-scope"}


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def fields(value, names):
    if type(value) is not dict or set(value) != set(names.split()):
        raise ValueError("contract_fields")


def relative_path(value):
    if not isinstance(value, str) or not value or "\\" in value or ":" in value:
        raise ValueError("asset_path")
    if Path(value).is_absolute() or any(x in {"", ".", ".."} for x in value.split("/")):
        raise ValueError("asset_path")


def validate_definition(d):
    fields(d, "schema_version team lead design_lead workers source assets pins required_capabilities nodes")
    if d["schema_version"] != "0.1-research" or d["team"] not in {"framework", "downstream-demo"}:
        raise ValueError("definition_version_or_team")
    if d["lead"] == d["design_lead"] or type(d["workers"]) is not int or not 1 <= d["workers"] <= 2:
        raise ValueError("roles_or_worker_limit")
    if not set(d["required_capabilities"]) <= CAPABILITIES:
        raise ValueError("unsupported_capability")
    if not isinstance(d["source"], str) or len(d["source"]) != 64:
        raise ValueError("source_digest")
    for path in d["assets"]:
        relative_path(path)
    fields(d["pins"], "modules adapter model dataset")
    if any(not isinstance(v, str) or not v.startswith("fixture:") for v in d["pins"].values()):
        raise ValueError("fixture_pins_required")
    nodes = d["nodes"]
    if not isinstance(nodes, list) or not nodes:
        raise ValueError("empty_graph")
    seen = set()
    for node in nodes:
        fields(node, "id depends_on owner")
        if node["id"] in seen or node["owner"] != d["team"]:
            raise ValueError("node_ownership")
        if not set(node["depends_on"]) <= seen:
            raise ValueError("graph_not_topologically_ordered")
        seen.add(node["id"])


def definition(team, lead, scenario):
    return {
        "schema_version": "0.1-research", "team": team, "lead": lead,
        "design_lead": "emery" if team == "framework" else "demo-designer",
        "workers": 2, "source": digest({"scenario": scenario}),
        "assets": ["prompts/lead.md", "skills/acceptance.md"],
        "pins": {name: "fixture:" + name + ":1" for name in ["modules", "adapter", "model", "dataset"]},
        "required_capabilities": sorted(CAPABILITIES),
        "nodes": [{"id": name, "depends_on": [] if i == 0 else [names[i-1]], "owner": team}
                  for names in [["propose", "approve", "publish"]] for i, name in enumerate(names)],
    }


def request(team, run, operation, payload):
    return {"schema_version": "0.1-research", "team": team, "run": run,
            "operation": operation, "request_id": digest([team, run, operation, payload]), "payload": payload}


class RuntimeStub:
    def __init__(self, root, d):
        validate_definition(d)
        self.definition = copy.deepcopy(d)
        self.root = root / d["team"]
        self.root.mkdir()
        self.events = []
        self.runs = {}
        self.seen = {}

    def call(self, principal_team, req):
        fields(req, "schema_version team run operation request_id payload")
        if req["schema_version"] != "0.1-research":
            raise ValueError("request_version")
        if principal_team != req["team"] or req["team"] != self.definition["team"]:
            raise ValueError("team_scope")
        fingerprint = digest(req)
        key = (req["team"], req["run"], req["request_id"])
        if key in self.seen:
            if self.seen[key][0] != fingerprint:
                raise ValueError("request_id_conflict")
            if req["operation"] not in {"progress", "result", "handoff"}:
                return self.seen[key][1]
        op, payload = req["operation"], req["payload"]
        if op == "setup":
            if req["run"] in self.runs:
                raise ValueError("run_exists")
            fields(payload, "scenario")
            if payload["scenario"] not in {"technical", "administrative"}:
                raise ValueError("scenario")
            self.runs[req["run"]] = {"state": "READY", "scenario": payload["scenario"]}
        elif req["run"] not in self.runs:
            raise ValueError("run_missing")
        run = self.runs[req["run"]]
        result = None
        if op == "propose":
            if run["state"] != "READY":
                raise ValueError("state")
            artifact = ({"file": "index.html", "content": "<h1>Synthetic service dashboard</h1>"}
                        if run["scenario"] == "technical" else
                        {"file": "report.json", "content": {"invoice_count": 2, "total_cents": 4600}})
            run.update(state="AWAITING_APPROVAL", artifact=artifact, candidate=digest(artifact))
        elif op == "approve":
            fields(payload, "scope candidate source expires_at principal")
            fields(payload["scope"], "team run task")
            if payload["scope"] != {"team": req["team"], "run": req["run"], "task": "publish"}:
                raise ValueError("approval_scope")
            if run["state"] != "AWAITING_APPROVAL":
                raise ValueError("state")
            if payload["candidate"] != run["candidate"] or payload["source"] != self.definition["source"]:
                raise ValueError("stale_approval")
            if (type(payload["expires_at"]) not in (int, float)
                    or not math.isfinite(payload["expires_at"])
                    or payload["expires_at"] <= time.time()
                    or payload["principal"] != "fixture-founder"):
                raise ValueError("approval_identity_or_expiry")
            run.update(state="APPROVED", approval=copy.deepcopy(payload))
        elif op == "publish":
            if run["state"] != "APPROVED" or run["approval"]["expires_at"] <= time.time():
                raise ValueError("approval_required")
            if digest(run["artifact"]) != run["candidate"]:
                raise ValueError("candidate_changed")
            path = self.root / (digest(req["run"]) + ".json")
            path.write_text(json.dumps(run["artifact"], sort_keys=True))
            run.update(state="COMPLETED", path=str(path))
        elif op == "cancel":
            if run["state"] == "COMPLETED":
                raise ValueError("completed_action_not_undone")
            run["state"] = "CANCELLED"
        elif op == "handoff":
            result = {"schema_version": "0.1-research", "team": req["team"], "run": req["run"],
                      "source": self.definition["source"], "state": run["state"],
                      "candidate": run.get("candidate"), "unresolved_effects": []}
        elif op not in {"setup", "progress", "result"}:
            raise ValueError("operation")
        if result is None:
            result = {k: run[k] for k in ["state", "candidate"] if k in run}
        self.events.append({"schema_version": "0.1-research", "team": req["team"], "run": req["run"],
                            "sequence": len(self.events) + 1, "kind": "stub." + op,
                            "request_id": req["request_id"], "result_digest": digest(result)})
        self.seen[key] = (fingerprint, copy.deepcopy(result))
        return result


def admit_experiment(production, candidate):
    production, candidate = production.resolve(), candidate.resolve()
    if candidate == production or candidate.is_relative_to(production) or production.is_relative_to(candidate):
        raise ValueError("shared_writable_state")


def migrate(source):
    if source["schema_version"] != "0.1-research":
        raise ValueError("migration_source")
    migrated = copy.deepcopy(source)
    migrated["schema_version"] = "0.2-research"
    migrated["migration"] = {"source_digest": digest(source)}
    return migrated


def rollback(source, migrated, runtime_schema):
    if runtime_schema != "0.1-research":
        raise ValueError("runtime_rollback_unsupported")
    if migrated["migration"]["source_digest"] != digest(source):
        raise ValueError("rollback_source_changed")
    return copy.deepcopy(source)


def main():
    cases = []
    def passed(name, condition=True):
        assert condition, name
        cases.append({"case": name, "passed": True})
    def refused(name, function, expected):
        try:
            function()
        except ValueError as error:
            passed(name, str(error) == expected)
        else:
            raise AssertionError(name)
    definitions = [definition("framework", "coda", "technical"),
                   definition("downstream-demo", "separate-demo-lead", "administrative")]
    for d in definitions:
        validate_definition(d)
    passed("distinct_team_leads", definitions[0]["lead"] != definitions[1]["lead"])
    for name, field, value, error in [
        ("version", "schema_version", "9", "definition_version_or_team"),
        ("worker_limit", "workers", 3, "roles_or_worker_limit"),
        ("required_capability", "required_capabilities", ["unsupported"], "unsupported_capability"),
        ("absolute_asset", "assets", ["/private/key"], "asset_path"),
        ("traversal_asset", "assets", ["../private/key"], "asset_path"),
        ("cycle", "nodes", [{"id": "a", "depends_on": ["a"], "owner": "framework"}], "graph_not_topologically_ordered"),
        ("node_team", "nodes", [{"id": "a", "depends_on": [], "owner": "downstream-demo"}], "node_ownership"),
    ]:
        bad = copy.deepcopy(definitions[0]); bad[field] = value
        refused("reject_" + name, lambda: validate_definition(bad), error)
    bad = copy.deepcopy(definitions[0]); bad["api_key"] = "SYNTHETIC_NOT_A_SECRET"
    refused("unknown_secret_field", lambda: validate_definition(bad), "contract_fields")
    with tempfile.TemporaryDirectory(prefix="trellis-contracts-") as temporary:
        root = Path(temporary)
        runtimes = [RuntimeStub(root, d) for d in definitions]
        for d, runtime, scenario in zip(definitions, runtimes, ["technical", "administrative"]):
            team, run = d["team"], "demo-1"
            call = lambda op, p={}: runtime.call(team, request(team, run, op, p))
            passed(scenario + "_setup", call("setup", {"scenario": scenario})["state"] == "READY")
            proposal = call("propose")
            passed(scenario + "_progress", call("progress")["state"] == "AWAITING_APPROVAL")
            refused(scenario + "_unapproved_publish", lambda: call("publish"), "approval_required")
            approval = {"scope": {"team": team, "run": run, "task": "publish"},
                        "candidate": proposal["candidate"], "source": d["source"],
                        "expires_at": time.time() + 120, "principal": "fixture-founder"}
            stale = dict(approval, candidate="stale")
            refused(scenario + "_stale_approval", lambda: call("approve", stale), "stale_approval")
            refused(scenario + "_invalid_expiry", lambda: call("approve", dict(approval, expires_at=float("nan"))), "approval_identity_or_expiry")
            passed(scenario + "_approval", call("approve", approval)["state"] == "APPROVED")
            passed(scenario + "_publish", call("publish")["state"] == "COMPLETED")
            passed(scenario + "_progress_is_current", call("progress")["state"] == "COMPLETED")
            count = len(runtime.events)
            call("publish")
            passed(scenario + "_repeated_request", len(runtime.events) == count)
            passed(scenario + "_result", call("result")["state"] == "COMPLETED")
            passed(scenario + "_handoff", call("handoff")["source"] == d["source"])
            refused(scenario + "_completed_cancel", lambda: call("cancel"), "completed_action_not_undone")
            artifact = json.loads(Path(runtime.runs[run]["path"]).read_text())
            expected = "<h1>Synthetic service dashboard</h1>" if scenario == "technical" else {"invoice_count": 2, "total_cents": 4600}
            passed(scenario + "_artifact", artifact["content"] == expected)
        passed("state_directories_differ", runtimes[0].root != runtimes[1].root)
        refused("cross_team_request", lambda: runtimes[0].call("downstream-demo", request("framework", "demo-1", "result", {})), "team_scope")
        conflicting = request("framework", "demo-1", "result", {})
        conflicting["payload"] = {"changed": True}
        refused("conflicting_request_id", lambda: runtimes[0].call("framework", conflicting), "request_id_conflict")
        runtimes[0].call("framework", request("framework", "cancel-run", "setup", {"scenario": "technical"}))
        cancel = runtimes[0].call("framework", request("framework", "cancel-run", "cancel", {}))
        passed("cancel_before_action", cancel["state"] == "CANCELLED")
        for runtime in runtimes:
            passed(runtime.definition["team"] + "_event_sequence", [e["sequence"] for e in runtime.events] == list(range(1,len(runtime.events)+1)))
            passed(runtime.definition["team"] + "_metadata_only", all("content" not in e and "payload" not in e for e in runtime.events))
        experiment = root / "experiment"; experiment.mkdir()
        admit_experiment(runtimes[0].root, experiment)
        passed("separate_experiment_path")
        refused("same_experiment_path", lambda: admit_experiment(runtimes[0].root, runtimes[0].root), "shared_writable_state")
        alias = root / "alias"; alias.symlink_to(runtimes[0].root)
        refused("symlink_experiment_path", lambda: admit_experiment(runtimes[0].root, alias), "shared_writable_state")
        passed("trace_scope", all(e["team"] == "framework" for e in runtimes[0].events))
        scope_root = root / "approval-scope"; scope_root.mkdir()
        scope_definitions = [definition("framework", "coda", "technical"),
                             definition("downstream-demo", "separate-demo-lead", "technical")]
        scope_runtimes = [RuntimeStub(scope_root, d) for d in scope_definitions]
        for runtime, run_id in [(scope_runtimes[0], "alpha"), (scope_runtimes[0], "beta"), (scope_runtimes[1], "alpha")]:
            team = runtime.definition["team"]
            runtime.call(team, request(team, run_id, "setup", {"scenario": "technical"}))
            runtime.call(team, request(team, run_id, "propose", {}))
        source_runtime = scope_runtimes[0]
        scoped_approval = {"scope": {"team": "framework", "run": "alpha", "task": "publish"},
                           "candidate": source_runtime.runs["alpha"]["candidate"],
                           "source": source_runtime.definition["source"],
                           "expires_at": time.time() + 120, "principal": "fixture-founder"}
        refused("approval_cannot_transfer_runs", lambda: source_runtime.call("framework", request("framework", "beta", "approve", scoped_approval)), "approval_scope")
        refused("approval_cannot_transfer_teams", lambda: scope_runtimes[1].call("downstream-demo", request("downstream-demo", "alpha", "approve", scoped_approval)), "approval_scope")
    original = definitions[0]; migrated = migrate(original)
    passed("definition_migration", migrated["schema_version"] == "0.2-research")
    passed("definition_rollback", rollback(original, migrated, "0.1-research") == original)
    refused("runtime_rollback_refused", lambda: rollback(original, migrated, "0.2-research"), "runtime_rollback_unsupported")
    results = {"measured_on": "2026-10-01", "scope": "Synthetic composition only. No runtime enforcement, authentication, crash safety, YAML parser, or real module integration.",
               "model_calls": 0, "passed": len(cases), "failed": 0, "cases": cases}
    (HERE / "results.json").write_text(json.dumps(results, indent=2) + "\n")
    (HERE / "portable-examples.json").write_text(json.dumps(definitions, indent=2) + "\n")
    print(json.dumps({"passed": len(cases), "failed": 0, "model_calls": 0}))


if __name__ == "__main__":
    main()
