"""Synthetic release-coordination model, not Trellis production behavior.

Representative proposed change: require run_id on Roots-targeted task events.
Relay's sender adds the field and Roots' receiver requires it. Both repository
shapes use the same module artifacts, compatibility rules, and acceptance tests.
The source revision identifiers below are deterministic synthetic hashes.
"""
from dataclasses import dataclass, asdict
from hashlib import sha256
import json


@dataclass(frozen=True)
class Artifact:
    module: str
    protocol: str
    source_revision: str
    contract_digest: str


def digest(value):
    return sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()


def artifacts(protocol):
    contract = {"scope": "Roots-targeted events", "required": ["event"] + (["run_id"] if protocol == "1.1" else [])}
    contract_digest = digest(contract)
    return {name: Artifact(name, protocol, digest([name, protocol, contract]), contract_digest) for name in ("relay", "roots")}


old, new = artifacts("1.0"), artifacts("1.1")


def produce(artifact):
    event = {"event": {"type": "task.completed"}}
    if artifact.protocol == "1.1":
        event["run_id"] = "synthetic-run-1"
    return event


def consume(artifact, event):
    return "event" in event and (artifact.protocol == "1.0" or bool(event.get("run_id")))


def release_manifest(shape, selected):
    pins = {name: asdict(artifact) for name, artifact in selected.items()}
    return {
        "shape": shape,
        "framework_revision": digest(pins) if shape == "single" else None,
        "module_pins": pins,
        "contract_digest": selected["roots"].contract_digest,
    }


def admit(manifest, installed):
    return (
        set(installed) == set(manifest["module_pins"])
        and all(asdict(installed[name]) == pin for name, pin in manifest["module_pins"].items())
        and all(a.contract_digest == manifest["contract_digest"] for a in installed.values())
    )


cases = []
def test(name, actual, expected):
    assert actual == expected, (name, actual, expected)
    cases.append({"case": name, "observed": actual, "expected": expected})


for producer_label, producer in (("old", old), ("new", new)):
    for consumer_label, consumer in (("old", old), ("new", new)):
        expected = not (producer_label == "old" and consumer_label == "new")
        test(f"compatibility/{producer_label}-sender/{consumer_label}-receiver", consume(consumer["roots"], produce(producer["relay"])), expected)

plans = {}
for shape in ("single", "coordinated"):
    before, after = release_manifest(shape, old), release_manifest(shape, new)
    test(f"{shape}/clean-selection", admit(after, new), True)
    mixed = {"relay": old["relay"], "roots": new["roots"]}
    test(f"{shape}/reject-mixed-install", admit(after, mixed), False)
    test(f"{shape}/reject-mixed-proposed-manifest", admit(release_manifest(shape, mixed), mixed), False)
    test(f"{shape}/rollback-whole-pair", admit(before, old) and consume(old["roots"], produce(old["relay"])), True)
    test(f"{shape}/reject-partial-rollback", admit(before, {"relay": new["relay"], "roots": old["roots"]}), False)
    plans[shape] = {
        "before": before,
        "after": after,
        "review_units_in_this_proposed_process": ["one framework candidate including both modules and the release manifest"] if shape == "single" else ["relay candidate", "roots candidate", "framework integration manifest candidate"],
        "install_process_modeled": "select exact source revision and module artifact digests; run pair contract acceptance; activate only a complete pair",
        "rollback_process_modeled": "restore prior complete release manifest and retained artifacts; state schema rollback is outside this fixture",
        "tests_required": ["relay unit tests", "roots unit tests", "cross-module contract fixtures", "release pin validation"],
    }

print(json.dumps({
    "experiment": "Proposed run_id contract change across Relay and Roots",
    "nature": "deterministic synthetic model, not an install, build, release, timing benchmark, or durable-state recovery test",
    "passed": len(cases), "cases": cases, "plans": plans,
    "conclusion_limit": "Both shapes can enforce the same pair contract. A single source commit alone cannot prevent mixed deployed artifacts. The review-unit difference follows the proposed process, not a measured productivity result.",
}, indent=2))
