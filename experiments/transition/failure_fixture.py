"""Synthetic durable-execution experiment. Python standard library only.

This is not Trellis implementation. It uses private fixture databases, a
non-idempotent simulated external ledger, and controlled SIGKILL points.
It never contacts a vendor, service, model, or business data source.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import signal
import sqlite3
import subprocess
import sys
import time
from datetime import datetime, timezone


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"))


def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def connect(path, readonly=False):
    db = sqlite3.connect(f"file:{path}?mode=ro" if readonly else path, uri=readonly, timeout=2)
    db.row_factory = sqlite3.Row
    if not readonly:
        db.execute("PRAGMA journal_mode=WAL")
        db.execute("PRAGMA synchronous=FULL")
    return db


class Refused(Exception):
    pass


class Store:
    def __init__(self, root, team="trellis-test"):
        self.root = Path(root)
        self.path = self.root / "state.sqlite"
        self.team = team
        self.db = connect(self.path)
        actual = self.db.execute("SELECT team FROM scope").fetchone()[0]
        if actual != team:
            self.db.close()
            raise Refused("wrong_team")

    @classmethod
    def init(cls, root, team="trellis-test"):
        root = Path(root)
        root.mkdir(parents=True)
        db = connect(root / "state.sqlite")
        db.executescript("""
        CREATE TABLE scope(team TEXT NOT NULL);
        CREATE TABLE task(id TEXT PRIMARY KEY, run_id TEXT, revision INTEGER,
          action_digest TEXT, status TEXT, owner TEXT, epoch INTEGER,
          lease_until INTEGER, op_key TEXT, artifact_sha TEXT, cancel_requested INTEGER);
        CREATE TABLE approvals(revision INTEGER, action_digest TEXT, approver TEXT,
          PRIMARY KEY(revision,action_digest));
        CREATE TABLE events(seq INTEGER PRIMARY KEY, kind TEXT, payload TEXT);
        CREATE TABLE handoffs(digest TEXT PRIMARY KEY, payload TEXT, consumed INTEGER);
        """)
        db.execute("INSERT INTO scope VALUES (?)", (team,))
        db.execute("INSERT INTO task VALUES ('task-1','run-1',1,?,'READY',NULL,0,0,NULL,NULL,0)", (digest({"synthetic_action": 1}),))
        db.commit()
        db.close()
        remote = connect(root / "external.sqlite")
        # No uniqueness constraint: duplicate dispatches would create duplicate effects.
        remote.execute("CREATE TABLE effects(seq INTEGER PRIMARY KEY, operation_key TEXT, payload_digest TEXT)")
        remote.commit()
        remote.close()
        return cls(root, team)

    def close(self):
        self.db.close()

    def row(self):
        return dict(self.db.execute("SELECT * FROM task WHERE id='task-1'").fetchone())

    def event(self, kind, **data):
        self.db.execute("INSERT INTO events(kind,payload) VALUES (?,?)", (kind, canonical(data)))

    def begin(self):
        self.db.execute("BEGIN IMMEDIATE")

    def claim(self, owner, now=100):
        self.begin()
        try:
            row = self.row()
            if row["status"] not in ("READY", "PREPARED"):
                raise Refused("not_claimable")
            if row["owner"] and row["owner"] != owner and row["lease_until"] > now:
                raise Refused("already_owned")
            epoch = row["epoch"] + 1
            self.db.execute("UPDATE task SET owner=?,epoch=?,lease_until=?", (owner, epoch, now + 30))
            self.event("task.claimed", owner=owner, epoch=epoch)
            self.db.commit()
            return epoch
        except BaseException:
            self.db.rollback()
            raise

    def guard(self, owner, epoch, now):
        row = self.row()
        if row["owner"] != owner or row["epoch"] != epoch or row["lease_until"] <= now:
            raise Refused("stale_owner")
        return row

    def approve(self, revision=None, action_digest=None):
        row = self.row()
        revision = row["revision"] if revision is None else revision
        action_digest = row["action_digest"] if action_digest is None else action_digest
        with self.db:
            self.db.execute("INSERT OR REPLACE INTO approvals VALUES (?,?,'fixture-founder')", (revision, action_digest))
            self.event("approval.granted", revision=revision, action_digest=action_digest)

    def revise(self):
        self.begin()
        try:
            row = self.row()
            if row["status"] not in ("READY", "PREPARED"):
                raise Refused("cannot_revise")
            revision = row["revision"] + 1
            self.db.execute("UPDATE task SET revision=?,action_digest=?,status='READY',artifact_sha=NULL,op_key=NULL", (revision, digest({"synthetic_action": revision})))
            self.event("task.revised", revision=revision)
            self.db.commit()
        except BaseException:
            self.db.rollback()
            raise

    def prepare(self, owner, epoch, now=100):
        self.begin()
        try:
            row = self.guard(owner, epoch, now)
            if row["status"] == "PREPARED":
                self.db.commit()
                return
            if row["status"] != "READY" or row["cancel_requested"]:
                raise Refused("not_preparable")
            content = canonical({"team": self.team, "run": row["run_id"], "revision": row["revision"], "synthetic": True}).encode()
            temp = self.root / "artifact.tmp"
            with temp.open("wb") as f:
                f.write(content)
                f.flush()
                os.fsync(f.fileno())
            os.replace(temp, self.root / "artifact.json")
            self.db.execute("UPDATE task SET status='PREPARED',artifact_sha=?", (hashlib.sha256(content).hexdigest(),))
            self.event("action.prepared", revision=row["revision"])
            self.db.commit()
        except BaseException:
            self.db.rollback()
            raise

    def dispatch(self, owner, epoch, failpoint="", now=100):
        self.begin()
        try:
            row = self.guard(owner, epoch, now)
            if row["status"] != "PREPARED":
                raise Refused("dependency_or_state_gate")
            if row["cancel_requested"]:
                raise Refused("cancelled")
            approval = self.db.execute("SELECT 1 FROM approvals WHERE revision=? AND action_digest=?", (row["revision"], row["action_digest"])).fetchone()
            if not approval:
                raise Refused("stale_or_missing_approval")
            actual_hash = hashlib.sha256((self.root / "artifact.json").read_bytes()).hexdigest()
            if actual_hash != row["artifact_sha"]:
                raise Refused("artifact_changed")
            op_key = digest([self.team, row["run_id"], row["id"], row["revision"], row["action_digest"]])
            self.db.execute("UPDATE task SET status='IN_FLIGHT',op_key=?", (op_key,))
            self.event("action.dispatch_intent_recorded", operation_key=op_key)
            if failpoint == "uncommitted_intent":
                os.kill(os.getpid(), signal.SIGKILL)
            self.db.commit()
        except BaseException:
            self.db.rollback()
            raise
        if failpoint == "intent_before_effect":
            os.kill(os.getpid(), signal.SIGKILL)
        remote = connect(self.root / "external.sqlite")
        with remote:
            remote.execute("INSERT INTO effects(operation_key,payload_digest) VALUES (?,?)", (op_key, row["action_digest"]))
        remote.close()
        if failpoint == "effect_before_ack":
            os.kill(os.getpid(), signal.SIGKILL)
        if failpoint == "readonly_ack":
            readonly = connect(self.path, readonly=True)
            try:
                readonly.execute("UPDATE task SET status='COMPLETED'")
            finally:
                readonly.close()
        with self.db:
            self.db.execute("UPDATE task SET status='COMPLETED' WHERE status='IN_FLIGHT' AND op_key=?", (op_key,))
            self.event("action.receipt_recorded", operation_key=op_key)

    def run(self, owner, epoch, failpoint="", now=100):
        if self.row()["status"] == "COMPLETED":
            return "already_completed"
        self.prepare(owner, epoch, now)
        if failpoint == "before_dispatch":
            os.kill(os.getpid(), signal.SIGKILL)
        self.dispatch(owner, epoch, failpoint, now)
        return self.row()["status"]

    def recover(self, failpoint=""):
        if failpoint == "recovery_read_error":
            raise sqlite3.OperationalError("injected recovery read failure")
        self.begin()
        try:
            row = self.row()
            if row["status"] == "IN_FLIGHT":
                self.db.execute("UPDATE task SET status='NEEDS_RECONCILIATION',owner=NULL,epoch=epoch+1,lease_until=0")
                self.event("recovery.blocked", reason="external_outcome_unknown")
            elif row["status"] in ("READY", "PREPARED"):
                self.db.execute("UPDATE task SET owner=NULL,epoch=epoch+1,lease_until=0")
                self.event("task.recoverable", from_state=row["status"])
            self.db.commit()
            return self.row()["status"]
        except BaseException:
            self.db.rollback()
            raise

    def cancel(self):
        self.begin()
        try:
            row = self.row()
            self.db.execute("UPDATE task SET cancel_requested=1")
            self.event("task.cancel_requested", previous_state=row["status"])
            if row["status"] in ("READY", "PREPARED"):
                self.db.execute("UPDATE task SET status='CANCELLED',owner=NULL,epoch=epoch+1,lease_until=0")
                self.event("task.cancelled", external_effect_started=False)
            self.db.commit()
        except BaseException:
            self.db.rollback()
            raise
        if self.row()["status"] == "CANCELLED":
            (self.root / "artifact.json").unlink(missing_ok=True)

    def reconcile(self):
        row = self.row()
        if row["status"] != "NEEDS_RECONCILIATION":
            raise Refused("not_reconcilable")
        remote = connect(self.root / "external.sqlite", readonly=True)
        count = remote.execute("SELECT COUNT(*) FROM effects WHERE operation_key=?", (row["op_key"],)).fetchone()[0]
        remote.close()
        if count > 1:
            raise Refused("duplicate_external_effects")
        state = "COMPLETED" if count else ("CANCELLED" if row["cancel_requested"] else "PREPARED")
        # Explicit simulated operator decision after reading an authoritative ledger.
        with self.db:
            self.db.execute("UPDATE task SET status=?", (state,))
            self.event("action.reconciled", operator="fixture-founder", effects=count, state=state)
        return state

    def export_handoff(self):
        row = self.row()
        payload = {"schema": 1, "team": self.team, "run": row["run_id"], "task": row["id"], "revision": row["revision"], "action_digest": row["action_digest"], "state": row["status"], "epoch": row["epoch"], "artifact_sha": row["artifact_sha"], "source_harness": "fixture-a"}
        key = digest(payload)
        with self.db:
            self.db.execute("INSERT INTO handoffs VALUES (?,?,0)", (key, canonical(payload)))
        envelope = {"payload": payload, "digest": key}
        (self.root / "handoff.json").write_text(json.dumps(envelope, indent=2))
        return envelope

    def accept_handoff(self, envelope, owner):
        self.begin()
        try:
            payload, key = envelope["payload"], envelope["digest"]
            if digest(payload) != key or payload["team"] != self.team or payload["schema"] != 1:
                raise Refused("invalid_handoff")
            saved = self.db.execute("SELECT * FROM handoffs WHERE digest=?", (key,)).fetchone()
            if saved is None or saved["consumed"] or saved["payload"] != canonical(payload):
                raise Refused("unknown_or_consumed_handoff")
            row = self.row()
            for field, expected in (("run_id", payload["run"]), ("id", payload["task"]), ("revision", payload["revision"]), ("action_digest", payload["action_digest"]), ("status", payload["state"]), ("epoch", payload["epoch"]), ("artifact_sha", payload["artifact_sha"])):
                if row[field] != expected:
                    raise Refused("stale_handoff")
            if row["status"] not in ("PREPARED", "COMPLETED"):
                raise Refused("unsafe_handoff_state")
            if hashlib.sha256((self.root / "artifact.json").read_bytes()).hexdigest() != payload["artifact_sha"]:
                raise Refused("artifact_changed")
            epoch = row["epoch"] + 1
            self.db.execute("UPDATE task SET owner=?,epoch=?,lease_until=130", (owner, epoch))
            self.db.execute("UPDATE handoffs SET consumed=1 WHERE digest=?", (key,))
            self.event("handoff.accepted", owner=owner, epoch=epoch, target_harness="fixture-b")
            self.db.commit()
            return epoch
        except BaseException:
            self.db.rollback()
            raise

    def snapshot(self):
        remote = connect(self.root / "external.sqlite", readonly=True)
        effects = [dict(r) for r in remote.execute("SELECT * FROM effects")]
        remote.close()
        return {"task": self.row(), "effects": effects, "events": [dict(r) for r in self.db.execute("SELECT * FROM events ORDER BY seq")], "artifact_exists": (self.root / "artifact.json").exists()}


def child(root, op, owner="worker-a", epoch=1, failpoint="", team="trellis-test"):
    command = [sys.executable, str(Path(__file__).resolve()), "child", str(root), op, owner, str(epoch), failpoint, team]
    start = time.perf_counter_ns()
    p = subprocess.run(command, capture_output=True, text=True)
    return {"command": command, "returncode": p.returncode, "stdout": p.stdout.strip(), "stderr": p.stderr.strip(), "elapsed_ms": (time.perf_counter_ns()-start)/1e6}


def refused(fn, reason=None):
    try:
        fn()
    except Refused as exc:
        if reason:
            assert str(exc) == reason, (str(exc), reason)
        return str(exc)
    raise AssertionError("expected refusal")


def suite(destination):
    destination = Path(destination).resolve()
    destination.mkdir(parents=True, exist_ok=False)
    results = []
    def case(name, fn):
        start = time.perf_counter_ns()
        root = destination / name
        store = Store.init(root)
        info = {"processes": [], "interventions": [], "checks": [], "recovery_ms": None}
        try:
            fn(store, info)
            snapshot = store.snapshot()
            counts = {}
            for effect in snapshot["effects"]:
                counts[effect["operation_key"]] = counts.get(effect["operation_key"], 0) + 1
            duplicates = sum(max(v-1,0) for v in counts.values())
            assert duplicates == 0
            elapsed = (time.perf_counter_ns()-start)/1e6
            result = {"case": name, "passed": True, "elapsed_ms": elapsed, "completion_ms": elapsed if snapshot["task"]["status"] == "COMPLETED" else None, "external_effects": len(snapshot["effects"]), "duplicate_effects": duplicates, "intervention_count": len(info["interventions"]), "final_state": snapshot["task"]["status"], **info, "snapshot": snapshot}
            results.append(result)
            (root / "result.json").write_text(json.dumps(result, indent=2))
        finally:
            store.close()

    def setup(s):
        epoch = s.claim("worker-a")
        s.approve()
        return epoch

    def happy(s, i):
        epoch = setup(s)
        i["processes"].append(child(s.root, "run", epoch=epoch))
        assert i["processes"][-1]["returncode"] == 0
        i["processes"].append(child(s.root, "run", epoch=epoch))
        assert "already_completed" in i["processes"][-1]["stdout"]
        assert len(s.snapshot()["effects"]) == 1
    case("01_restart_completed_no_repeat", happy)

    def dependency(s, i):
        epoch = setup(s)
        i["checks"].append(refused(lambda:s.dispatch("worker-a",epoch),"dependency_or_state_gate"))
        assert s.row()["status"] == "READY"
    case("02_dependency_gate", dependency)

    def owners(s, i):
        commands = [[sys.executable,str(Path(__file__).resolve()),"child",str(s.root),"claim",who,"0","","trellis-test"] for who in ("worker-a","worker-b")]
        processes = [subprocess.Popen(c,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True) for c in commands]
        for cmd,p in zip(commands,processes):
            stdout,stderr=p.communicate()
            i["processes"].append({"command":cmd,"returncode":p.returncode,"stdout":stdout.strip(),"stderr":stderr.strip()})
        assert sorted(p.returncode for p in processes) == [0,3]
        assert s.row()["epoch"] == 1
        i["checks"].append("one of two concurrent claimers admitted")
    case("03_concurrent_ownership", owners)

    def stale_owner(s,i):
        first=setup(s);s.prepare("worker-a",first)
        second=s.claim("worker-b",now=200)
        i["checks"].append(refused(lambda:s.dispatch("worker-a",first,now=200),"stale_owner"))
        s.dispatch("worker-b",second,now=200)
    case("04_expired_owner_fenced",stale_owner)

    def stale_approval(s,i):
        epoch=setup(s);s.revise();s.prepare("worker-a",epoch)
        i["checks"].append(refused(lambda:s.dispatch("worker-a",epoch),"stale_or_missing_approval"))
        assert len(s.snapshot()["effects"])==0
        i["interventions"].append("simulated founder approves the changed revision and action digest")
        s.approve();s.dispatch("worker-a",epoch)
    case("05_stale_approval",stale_approval)

    def crash(failpoint, needs_reconciliation, errorcode=-9, recovery_error=False, cancel=False):
        def f(s,i):
            epoch=setup(s)
            p=child(s.root,"run",epoch=epoch,failpoint=failpoint);i["processes"].append(p)
            assert p["returncode"]==errorcode,(p,failpoint)
            if cancel:s.cancel()
            started=time.perf_counter_ns()
            if recovery_error:
                p=child(s.root,"recover",failpoint="recovery_read_error");i["processes"].append(p)
                assert p["returncode"]==4
                assert s.row()["status"]=="IN_FLIGHT"
                i["interventions"].append("simulated operator clears the injected storage-read failure")
            p=child(s.root,"recover");i["processes"].append(p);assert p["returncode"]==0
            if needs_reconciliation:
                assert s.row()["status"]=="NEEDS_RECONCILIATION"
                i["checks"].append(refused(lambda:s.claim("worker-b"),"not_claimable"))
                i["interventions"].append("simulated operator queries the authoritative external ledger and records the outcome")
                s.reconcile()
            if s.row()["status"]=="PREPARED":
                epoch=s.claim("worker-b")
                p=child(s.root,"run",owner="worker-b",epoch=epoch);i["processes"].append(p);assert p["returncode"]==0
            i["recovery_ms"]=(time.perf_counter_ns()-started)/1e6
            assert s.row()["status"]=="COMPLETED"
            assert len(s.snapshot()["effects"])==1
        return f
    case("06_crash_before_dispatch",crash("before_dispatch",False))
    case("07_crash_intent_before_effect",crash("intent_before_effect",True))
    case("08_crash_after_effect_before_ack",crash("effect_before_ack",True))
    case("09_crash_uncommitted_intent",crash("uncommitted_intent",False))
    case("10_persistence_readonly_ack",crash("readonly_ack",True,errorcode=4))
    case("11_recovery_read_error",crash("effect_before_ack",True,recovery_error=True))

    def cancelled(s,i):
        epoch=setup(s);s.prepare("worker-a",epoch);assert (s.root/"artifact.json").exists()
        s.cancel();assert not (s.root/"artifact.json").exists()
        i["checks"].append(refused(lambda:s.claim("worker-b"),"not_claimable"))
        assert s.row()["status"]=="CANCELLED" and len(s.snapshot()["effects"])==0
    case("12_cancel_before_dispatch",cancelled)
    case("13_cancel_after_effect",crash("effect_before_ack",True,cancel=True))

    def handoff(s,i):
        epoch=setup(s);s.prepare("worker-a",epoch)
        envelope=s.export_handoff()
        tampered=json.loads(json.dumps(envelope));tampered["payload"]["revision"]=100
        i["checks"].append(refused(lambda:s.accept_handoff(tampered,"worker-b"),"invalid_handoff"))
        next_epoch=s.accept_handoff(json.loads((s.root/"handoff.json").read_text()),"worker-b")
        i["checks"].append(refused(lambda:s.dispatch("worker-a",epoch),"stale_owner"))
        p=child(s.root,"run",owner="worker-b",epoch=next_epoch);i["processes"].append(p);assert p["returncode"]==0
        i["checks"].append(refused(lambda:s.accept_handoff(envelope,"worker-c"),"unknown_or_consumed_handoff"))
        completed=s.export_handoff();third=s.accept_handoff(completed,"worker-c")
        p=child(s.root,"run",owner="worker-c",epoch=third);i["processes"].append(p)
        assert "already_completed" in p["stdout"] and len(s.snapshot()["effects"])==1
    case("14_artifact_handoff",handoff)

    def separation(s,i):
        downstream=Store.init(s.root/"future-product-team",team="future-product-test")
        try:
            before=canonical(downstream.snapshot())
            i["checks"].append(refused(lambda:Store(s.root,team="future-product-test"),"wrong_team"))
            epoch=setup(s);s.run("worker-a",epoch)
            assert before==canonical(downstream.snapshot())
            i["checks"].append("separate future-product fixture state unchanged")
        finally:downstream.close()
    case("15_separate_team_state",separation)

    result={"observed_at":datetime.now(timezone.utc).isoformat(),"python":sys.version,"sqlite":sqlite3.sqlite_version,"platform":platform.platform(),"clock_note":"Lease clock is synthetic; elapsed times use perf_counter_ns. Human delays are not measured.","fixture_source_sha256":hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),"scope":"Non-model local synthetic experiment. Not production Trellis, real external service, or DBOS.","cases":results,"summary":{"cases":len(results),"passed":len(results),"completed":sum(x["final_state"]=="COMPLETED" for x in results),"safe_nonterminal_or_cancelled":sum(x["final_state"]!="COMPLETED" for x in results),"external_effects":sum(x["external_effects"] for x in results),"duplicate_effects":sum(x["duplicate_effects"] for x in results),"simulated_interventions":sum(x["intervention_count"] for x in results)}}
    (destination/"results.json").write_text(json.dumps(result,indent=2))
    print(json.dumps({"directory":str(destination),"summary":result["summary"]},indent=2))


if __name__=="__main__":
    if len(sys.argv)>1 and sys.argv[1]=="child":
        _,_,root,op,owner,epoch,failpoint,team=sys.argv
        try:
            s=Store(root,team)
            try:
                value=s.claim(owner) if op=="claim" else s.recover(failpoint) if op=="recover" else s.run(owner,int(epoch),failpoint)
                print(json.dumps({"result":value,"state":s.row()["status"]}))
            finally:s.close()
        except Refused as exc:
            print(json.dumps({"refused":str(exc)}));sys.exit(3)
        except sqlite3.Error as exc:
            print(json.dumps({"storage_error":str(exc)}));sys.exit(4)
    else:
        parser=argparse.ArgumentParser()
        parser.add_argument("--output",required=True,help="New directory entirely owned by this fixture")
        suite(parser.parse_args().output)
