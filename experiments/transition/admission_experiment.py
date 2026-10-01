"""Synthetic admission experiment, not a production quota controller.

All percentages and job reservations below are fixtures, not provider budgets.
Run: python3 admission_experiment.py
"""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import json
import math
import sqlite3
import tempfile
import time


class Admission:
    def __init__(self, path):
        self.path = str(path)
        with sqlite3.connect(self.path) as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS leases (
                    job TEXT PRIMARY KEY, fingerprint TEXT NOT NULL,
                    estimate REAL NOT NULL, active INTEGER NOT NULL,
                    finished REAL
                );
                CREATE TABLE IF NOT EXISTS observed (
                    window TEXT PRIMARY KEY, reset REAL NOT NULL,
                    high REAL NOT NULL, sampled REAL NOT NULL
                );
            """)

    def admit(self, job, *, windows, required, observed_at, now,
              estimate=5, billing="subscription", route="evaluated-small",
              limit=2, threshold=75, max_age=60):
        # Proposed fixture policy: stale signals and unknown routes fail closed.
        if billing != "subscription":
            return "billing-route-refused"
        if route not in {"evaluated-small", "evaluated-large"}:
            return "route-not-evaluated"
        def finite(value):
            return type(value) in (int, float) and math.isfinite(value)
        if not finite(now) or now < 0:
            return "clock-invalid"
        if (type(limit) is not int or not 1 <= limit <= 2
                or not finite(threshold) or not 0 < threshold <= 75
                or not finite(max_age) or max_age <= 0):
            return "policy-invalid"
        if not isinstance(estimate, (int, float)) or isinstance(estimate, bool) or not math.isfinite(estimate) or estimate <= 0:
            return "estimate-unknown"
        if not finite(observed_at) or observed_at < 0 or observed_at > now or now - observed_at > max_age:
            return "usage-stale"
        if not required or not windows or not set(required) <= set(windows):
            return "window-missing"
        for value in windows.values():
            used, reset = value
            if not isinstance(used, (int, float)) or isinstance(used, bool) or not math.isfinite(used) or not 0 <= used <= 100:
                return "usage-invalid"
            if not finite(reset) or reset <= now:
                return "fresh-reset-sample-required"
        fingerprint = json.dumps([estimate, billing, route], separators=(",", ":"))
        with sqlite3.connect(self.path, timeout=10) as db:
            db.execute("BEGIN IMMEDIATE")
            # Persist the complete observation even when admission is refused.
            observations = []
            for key, (used, reset) in windows.items():
                prior = db.execute("SELECT reset,high,sampled FROM observed WHERE window=?", (key,)).fetchone()
                if prior and (reset < prior[0] or observed_at < prior[2]):
                    return "usage-out-of-order"
                effective = max(used, prior[1]) if prior and reset == prior[0] else used
                observations.append((key, reset, effective, observed_at))
            db.executemany("INSERT OR REPLACE INTO observed VALUES (?,?,?,?)", observations)
            existing = db.execute("SELECT fingerprint, active FROM leases WHERE job=?", (job,)).fetchone()
            if existing:
                if existing[0] != fingerprint:
                    return "job-conflict"
                return "already-admitted" if existing[1] else "already-finished"
            if db.execute("SELECT count(*) FROM leases WHERE active=1").fetchone()[0] >= limit:
                return "worker-limit"
            # Keep reservations until a fresh sample follows an explicit finish.
            outstanding = db.execute(
                "SELECT coalesce(sum(estimate),0) FROM leases WHERE active=1 OR finished>=?",
                (observed_at,),
            ).fetchone()[0]
            for key, reset, effective, sampled in observations:
                if effective + outstanding + estimate >= threshold:
                    return "reserve-stop"
            db.execute("INSERT INTO leases VALUES (?,?,?,1,NULL)", (job, fingerprint, estimate))
        return "admitted"

    def finish(self, job, now):
        if type(now) not in (int, float) or not math.isfinite(now) or now < 0:
            raise ValueError("clock-invalid")
        with sqlite3.connect(self.path) as db:
            db.execute("UPDATE leases SET active=0,finished=? WHERE job=? AND active=1", (now, job))


def run():
    results = []
    with tempfile.TemporaryDirectory(prefix="trellis-admission-fixture-") as tmp:
        counter = 0

        def fresh():
            nonlocal counter
            counter += 1
            return Admission(Path(tmp) / f"case-{counter}.sqlite")

        def request(controller, job="one", **overrides):
            args = dict(windows={"short": (10, 2000), "weekly": (20, 10000)},
                        required={"short", "weekly"}, observed_at=999, now=1000)
            args.update(overrides)
            return controller.admit(job, **args)

        def expect(name, actual, expected):
            if actual != expected:
                raise AssertionError(f"{name}: {actual!r} != {expected!r}")
            results.append({"scenario": name, "observed": actual, "expected": expected, "pass": True})

        expect("ample capacity", request(fresh()), "admitted")
        expect("at threshold", request(fresh(), windows={"short": (75, 2000), "weekly": (20, 10000)}), "reserve-stop")
        expect("headroom for job", request(fresh(), windows={"short": (70, 2000), "weekly": (20, 10000)}), "reserve-stop")
        expect("all windows bind", request(fresh(), windows={"short": (10, 2000), "weekly": (74, 10000)}), "reserve-stop")
        expect("missing window", request(fresh(), windows={"weekly": (20, 10000)}), "window-missing")
        expect("empty signal", request(fresh(), windows={}), "window-missing")
        expect("stale signal", request(fresh(), observed_at=900), "usage-stale")
        expect("future signal", request(fresh(), observed_at=1001), "usage-stale")
        expect("invalid percentage", request(fresh(), windows={"short": (float('nan'), 2000), "weekly": (20, 10000)}), "usage-invalid")
        expect("passed reset needs fresh signal", request(fresh(), windows={"short": (10, 999), "weekly": (20, 10000)}), "fresh-reset-sample-required")
        expect("unknown task allowance", request(fresh(), estimate=None), "estimate-unknown")
        expect("invalid current clock", request(fresh(), now=float("nan"), observed_at=0), "clock-invalid")
        expect("unknown observation type", request(fresh(), observed_at="recent"), "usage-stale")
        expect("invalid worker policy", request(fresh(), limit=float("nan")), "policy-invalid")
        expect("worker policy cannot exceed campaign cap", request(fresh(), limit=3), "policy-invalid")
        expect("reserve policy cannot exceed threshold", request(fresh(), threshold=100), "policy-invalid")
        expect("invalid freshness policy", request(fresh(), max_age=float("nan")), "policy-invalid")
        expect("paid fallback refused", request(fresh(), billing="api"), "billing-route-refused")
        expect("unevaluated model route", request(fresh(), route="any-cheaper-model"), "route-not-evaluated")
        a = fresh()
        expect("first admission", request(a), "admitted")
        expect("same job safe retry", request(a), "already-admitted")
        expect("same job changed route", request(a, route="evaluated-large"), "job-conflict")
        expect("second worker", request(a, "two"), "admitted")
        expect("third worker", request(a, "three"), "worker-limit")
        a.finish("one", 1001)
        expect("finished job is not replayed", request(a, "one", observed_at=1002, now=1002), "already-finished")
        expect("released worker slot", request(a, "three", observed_at=1002, now=1002), "admitted")
        a = fresh()
        expect("reservation setup", request(a, estimate=35), "admitted")
        a.finish("one", 1001)
        expect("completion with lagging sample", request(a, "two", estimate=25, now=1002), "reserve-stop")
        expect("completion with new sample", request(a, "two", estimate=25, observed_at=1002, now=1002), "admitted")
        a = fresh()
        expect("high water setup", request(a, windows={"short": (60, 2000), "weekly": (20, 10000)}), "admitted")
        expect("decreased signal same reset", request(a, "two", windows={"short": (1, 2000), "weekly": (20, 10000)}, estimate=10), "reserve-stop")
        a.finish("one", 1001)
        expect("new reset sampled", request(a, "two", windows={"short": (1, 3000), "weekly": (20, 10000)}, estimate=10, observed_at=1002, now=1002), "admitted")
        expect("old sample cannot restore capacity", request(a, "three", observed_at=1001, now=1003), "usage-out-of-order")
        a = fresh()
        with ThreadPoolExecutor(max_workers=16) as pool:
            outcomes = list(pool.map(lambda i: request(Admission(a.path), str(i)), range(16)))
        expect("concurrent admission counts", {"admitted": outcomes.count("admitted"), "refused": outcomes.count("worker-limit")}, {"admitted": 2, "refused": 14})
        expect("state survives controller restart", request(Admission(a.path), "after-restart"), "worker-limit")
        a = fresh()
        expect("reserve refusal records complete sample", request(a, windows={"short": (75, 2000), "weekly": (95, 10000)}), "reserve-stop")
        expect("later window high water persisted", sqlite3.connect(a.path).execute("SELECT high FROM observed WHERE window='weekly'").fetchone()[0], 95)
        expect("lower sample after refusal cannot admit", request(a, "later", observed_at=1001, now=1001), "reserve-stop")
        a = fresh()
        request(a, "one"); request(a, "two")
        expect("worker refusal retains observation", request(a, "three", windows={"short": (80, 2000), "weekly": (95, 10000)}, observed_at=1001, now=1001), "worker-limit")
        a.finish("one", 1002)
        expect("slot release cannot discard high water", request(a, "three", observed_at=1003, now=1003), "reserve-stop")
        a = fresh()
        request(a, "one")
        expect("repeat job retains observation", request(a, "one", windows={"short": (80, 2000), "weekly": (95, 10000)}, observed_at=1001, now=1001), "already-admitted")
        expect("another job respects repeat observation", request(a, "two", observed_at=1002, now=1002), "reserve-stop")
        a = fresh()
        request(a, "one", estimate=35)
        try:
            a.finish("one", float("nan"))
        except ValueError as error:
            expect("invalid finish clock refused", str(error), "clock-invalid")
        else:
            raise AssertionError("invalid finish clock accepted")
        expect("invalid finish keeps worker active", sqlite3.connect(a.path).execute("SELECT active FROM leases WHERE job='one'").fetchone()[0], 1)
        expect("invalid finish preserves reservation", request(a, "two", estimate=25, now=1002), "reserve-stop")

    report = {"kind": "synthetic-fixture", "production": False,
              "generatedAtUnix": time.time(), "caseCount": len(results),
              "cases": results,
              "limits": ["Fixture reservations are invented test inputs, not measured provider allowances.",
                         "This experiment does not bound provider usage, another client, or in-flight overshoot.",
                         "Explicit reconciliation is required after a worker crash; there is no automatic lease expiry.",
                         "No live model or paid API call runs."]}
    path = Path(__file__).with_name("results.json")
    path.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"passed": len(results), "failed": 0, "report": str(path)}))


if __name__ == "__main__":
    run()
