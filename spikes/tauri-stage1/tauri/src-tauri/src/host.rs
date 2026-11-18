//! The host: what the Tauri shell does with the Node core in its sidecar process. Same rules as the Electron host (src/host.mjs):
//!  - a call that is in the sidecar when it dies fails with FAILED and is never sent again;
//!  - a call made while the sidecar is down waits for the next one and is sent once;
//!  - every call returns or fails within the call limit (proposal: 30 seconds); a call that times out after it was sent fails with FAILED and its sidecar is replaced;
//!  - events from the sidecar reach the page in the order the sidecar sent them, once each.
//! The channel is the sidecar's stdin and stdout, one JSON message per line. Only this process holds the pipe, and no port is open.
//! State that lives in the sidecar (the plan shown last) is gone when the sidecar is replaced, because the new one starts empty.

use serde::{Deserialize, Serialize};
use serde_json::{value::RawValue, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{channel, RecvTimeoutError, Sender};
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

/// The error a failed call gets. `code` is the short refusal code of the call set.
#[derive(Debug, Clone, Serialize)]
pub struct CallError {
    pub code: String,
    pub message: String,
}

impl CallError {
    fn failed(message: &str) -> Self {
        CallError { code: "FAILED".into(), message: message.into() }
    }
}

type Reply = Result<String, CallError>;

struct Pending {
    tx: Sender<Reply>,
    sent: bool,
}

struct Inner {
    child: Option<Child>,
    stdin: Option<ChildStdin>,
    pid: Option<u32>,
    epoch: u64,
    ready: bool,
    stopped: bool,
    generation: u64,
    began: Instant,
    last_recovery_ms: u64,
    restarts: u64,
    sent_calls: u64,
    next_id: u64,
    pending: HashMap<u64, Pending>,
    queued: Vec<(u64, String)>,
}

pub struct Config {
    pub name: String,
    pub node: PathBuf,
    pub script: PathBuf,
    pub home: String,
    pub timeout: Duration,
    pub app: AppHandle,
}

pub struct Host {
    cfg: Config,
    inner: Mutex<Inner>,
    cv: Condvar,
}

#[derive(Serialize)]
pub struct Info {
    pub generation: u64,
    pub pid: Option<u32>,
    pub ready: bool,
    pub last_recovery_ms: u64,
    pub restarts: u64,
    pub sent_calls: u64,
}

#[derive(Deserialize)]
struct Msg<'a> {
    #[serde(rename = "type")]
    kind: &'a str,
    id: Option<u64>,
    ok: Option<bool>,
    code: Option<String>,
    message: Option<String>,
    seq: Option<u64>,
    #[serde(borrow)]
    value: Option<&'a RawValue>,
}

impl Host {
    pub fn start(cfg: Config) -> Arc<Host> {
        let host = Arc::new(Host {
            cfg,
            inner: Mutex::new(Inner {
                child: None,
                stdin: None,
                pid: None,
                epoch: 0,
                ready: false,
                stopped: false,
                generation: 0,
                began: Instant::now(),
                last_recovery_ms: 0,
                restarts: 0,
                sent_calls: 0,
                next_id: 0,
                pending: HashMap::new(),
                queued: Vec::new(),
            }),
            cv: Condvar::new(),
        });
        host.spawn_child();
        host
    }

    fn lock(&self) -> MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn spawn_child(self: &Arc<Self>) {
        let cfg = &self.cfg;
        let state = if cfg.home.is_empty() { String::new() } else { format!("{}/.local/state/bowerloom", cfg.home) };
        let spawned = Command::new(&cfg.node)
            .arg(&cfg.script)
            .env("SPIKE_HOME", &cfg.home)
            .env("SPIKE_STATE", state)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn();
        let mut child = match spawned {
            Ok(child) => child,
            Err(error) => {
                eprintln!("host {}: could not start the sidecar: {error}", cfg.name);
                return;
            }
        };
        let stdout = child.stdout.take().expect("piped stdout");
        let stdin = child.stdin.take().expect("piped stdin");
        let epoch = {
            let mut g = self.lock();
            g.epoch += 1;
            g.pid = Some(child.id());
            g.child = Some(child);
            g.stdin = Some(stdin);
            g.ready = false;
            g.began = Instant::now();
            g.epoch
        };
        let me = Arc::clone(self);
        thread::spawn(move || {
            let mut reader = BufReader::with_capacity(1 << 20, stdout);
            let mut line = String::new();
            loop {
                line.clear();
                match reader.read_line(&mut line) {
                    Ok(0) | Err(_) => break,
                    Ok(_) => me.on_line(epoch, &line),
                }
            }
            me.on_exit(epoch);
        });
    }

    fn on_line(&self, epoch: u64, line: &str) {
        let msg: Msg = match serde_json::from_str(line) {
            Ok(m) => m,
            Err(_) => return,
        };
        match msg.kind {
            "ready" => {
                let mut g = self.lock();
                if g.epoch != epoch {
                    return;
                }
                g.ready = true;
                g.generation += 1;
                g.last_recovery_ms = g.began.elapsed().as_millis() as u64;
                let queued: Vec<(u64, String)> = g.queued.drain(..).collect();
                for (id, text) in queued {
                    let wrote = match g.stdin.as_mut() {
                        Some(stdin) => stdin.write_all(text.as_bytes()).is_ok() && stdin.flush().is_ok(),
                        None => false,
                    };
                    if wrote {
                        g.sent_calls += 1;
                        if let Some(p) = g.pending.get_mut(&id) {
                            p.sent = true;
                        }
                    } else if let Some(p) = g.pending.remove(&id) {
                        let _ = p.tx.send(Err(CallError::failed("the sidecar pipe is closed")));
                    }
                }
                self.cv.notify_all();
            }
            "event" => {
                if let Some(seq) = msg.seq {
                    let _ = self.cfg.app.emit("core-event", (self.cfg.name.clone(), seq));
                }
            }
            "result" => {
                let Some(id) = msg.id else { return };
                let pending = self.lock().pending.remove(&id);
                if let Some(p) = pending {
                    let reply = if msg.ok == Some(true) {
                        Ok(msg.value.map(|v| v.get().to_string()).unwrap_or_else(|| "null".into()))
                    } else {
                        Err(CallError { code: msg.code.unwrap_or_else(|| "FAILED".into()), message: msg.message.unwrap_or_default() })
                    };
                    let _ = p.tx.send(reply);
                }
            }
            _ => {}
        }
    }

    fn on_exit(self: &Arc<Self>, epoch: u64) {
        let restart = {
            let mut g = self.lock();
            if g.epoch != epoch {
                return;
            }
            g.ready = false;
            g.stdin = None;
            g.pid = None;
            if let Some(mut child) = g.child.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
            // A call that was in the sidecar fails. It is never sent again. A call still waiting in the queue stays.
            let lost: Vec<u64> = g.pending.iter().filter(|(_, p)| p.sent).map(|(id, _)| *id).collect();
            for id in lost {
                if let Some(p) = g.pending.remove(&id) {
                    let _ = p.tx.send(Err(CallError::failed("the sidecar ended while the call was running")));
                }
            }
            if g.stopped {
                self.cv.notify_all();
                false
            } else {
                g.restarts += 1;
                true
            }
        };
        if restart {
            self.spawn_child();
        }
    }

    /// Ends the sidecar at once with SIGKILL, which it cannot catch. The reader thread sees the pipe close and starts a new one.
    fn kill_locked(g: &mut Inner) -> Option<u32> {
        g.ready = false;
        let pid = g.pid;
        if let Some(child) = g.child.as_mut() {
            let _ = child.kill();
        }
        pid
    }

    pub fn kill(&self) -> Option<u32> {
        Host::kill_locked(&mut self.lock())
    }

    pub fn call(self: &Arc<Self>, method: &str, args: &Value) -> Reply {
        let (tx, rx) = channel();
        let id;
        {
            let mut g = self.lock();
            if g.stopped {
                return Err(CallError::failed("the sidecar is stopped"));
            }
            g.next_id += 1;
            id = g.next_id;
            let text = format!("{}\n", serde_json::json!({ "type": "call", "id": id, "method": method, "args": args }));
            if g.ready && g.stdin.is_some() {
                let wrote = {
                    let stdin = g.stdin.as_mut().expect("checked");
                    stdin.write_all(text.as_bytes()).is_ok() && stdin.flush().is_ok()
                };
                if !wrote {
                    return Err(CallError::failed("the sidecar pipe is closed"));
                }
                g.sent_calls += 1;
                g.pending.insert(id, Pending { tx, sent: true });
            } else {
                g.pending.insert(id, Pending { tx, sent: false });
                g.queued.push((id, text));
            }
        }
        match rx.recv_timeout(self.cfg.timeout) {
            Ok(reply) => reply,
            Err(RecvTimeoutError::Timeout) => {
                let mut g = self.lock();
                let entry = g.pending.remove(&id);
                g.queued.retain(|q| q.0 != id);
                match entry {
                    // The answer came while the lock was awaited.
                    None => {
                        drop(g);
                        rx.try_recv().unwrap_or_else(|_| Err(CallError::failed("the call took longer than its limit")))
                    }
                    Some(p) => {
                        // A call that was sent and got no answer leaves the sidecar in an unknown state: replace it.
                        if p.sent {
                            Host::kill_locked(&mut g);
                        }
                        Err(CallError::failed("the call took longer than its limit"))
                    }
                }
            }
            Err(RecvTimeoutError::Disconnected) => Err(CallError::failed("the call was dropped")),
        }
    }

    /// Waits until a sidecar newer than `after` is ready. Returns the generation, or the last one on the limit.
    pub fn wait_ready(&self, after: u64, limit: Duration) -> u64 {
        let until = Instant::now() + limit;
        let mut g = self.lock();
        loop {
            if (g.ready && g.generation > after) || g.stopped {
                return g.generation;
            }
            let left = until.saturating_duration_since(Instant::now());
            if left.is_zero() {
                return g.generation;
            }
            g = self.cv.wait_timeout(g, left).unwrap_or_else(|e| e.into_inner()).0;
        }
    }

    pub fn info(&self) -> Info {
        let g = self.lock();
        Info { generation: g.generation, pid: g.pid, ready: g.ready, last_recovery_ms: g.last_recovery_ms, restarts: g.restarts, sent_calls: g.sent_calls }
    }

    pub fn pid(&self) -> Option<u32> {
        self.lock().pid
    }

    /// Stops the host: no restart, every waiting call fails, the sidecar is killed.
    pub fn stop(&self) {
        let mut g = self.lock();
        g.stopped = true;
        g.queued.clear();
        let all: Vec<u64> = g.pending.keys().copied().collect();
        for id in all {
            if let Some(p) = g.pending.remove(&id) {
                let _ = p.tx.send(Err(CallError::failed("the sidecar is stopped")));
            }
        }
        g.stdin = None;
        if let Some(child) = g.child.as_mut() {
            let _ = child.kill();
        }
        self.cv.notify_all();
    }
}
