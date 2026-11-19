//! The Tauri shell of the Stage 1 spike. It has a hidden window and no dock icon. The page runs one scenario (--scenario=NAME), writes its result to --out=FILE, and quits.
//! The commands below are the whole surface of the shell. The `core_*` commands are the call path (page, shell, sidecar pipe). `core_kill`, `write_result`, `report_pids`,
//! `quit_app` and `crash_app` exist only to drive tests. This is spike code, not the shipped app.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod host;

use host::{CallError, Config, Host, Info};
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
#[cfg(feature = "e2e")]
use std::sync::atomic::AtomicUsize;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, RunEvent, State};

#[derive(Default)]
struct Hosts(Mutex<HashMap<String, Arc<Host>>>);

#[derive(Clone, Serialize)]
struct Args {
    scenario: Option<String>,
    out: Option<String>,
    options: String,
    pid: u32,
    exe_path: String,
}

fn parse_args() -> Args {
    let argv: Vec<String> = std::env::args().collect();
    let get = |name: &str| argv.iter().find_map(|a| a.strip_prefix(&format!("--{name}=")).map(|s| s.to_string()));
    Args {
        scenario: get("scenario"),
        out: get("out"),
        options: get("options").unwrap_or_else(|| "{}".into()),
        pid: std::process::id(),
        exe_path: std::env::current_exe().map(|p| p.display().to_string()).unwrap_or_default(),
    }
}

fn host_of(hosts: &State<'_, Hosts>, name: &str) -> Result<Arc<Host>, CallError> {
    hosts.0.lock().unwrap().get(name).cloned().ok_or(CallError { code: "FAILED".into(), message: format!("no host named {name}") })
}

#[tauri::command]
fn app_args(args: State<'_, Args>) -> Args {
    eprintln!("shell: the page asked for its arguments");
    args.inner().clone()
}

/// Starts a host: the Node runtime beside the shell binary, running the core script from the resource folder. Waits until the core says it is ready.
#[tauri::command]
async fn core_start(app: AppHandle, hosts: State<'_, Hosts>, name: String, home: String, timeout_ms: u64) -> Result<u64, CallError> {
    let exe_dir = std::env::current_exe().ok().and_then(|p| p.parent().map(|d| d.to_path_buf())).ok_or(CallError { code: "FAILED".into(), message: "no exe folder".into() })?;
    // Tauri's resource resolver answers "unknown path" for an app that sits under a symlinked folder (a temp folder under /var). The bundle layout is fixed
    // (Contents/MacOS beside Contents/Resources), so fall back to it.
    let resources = match app.path().resource_dir() {
        Ok(dir) => dir,
        Err(_) => exe_dir.parent().map(|contents| contents.join("Resources")).ok_or(CallError { code: "FAILED".into(), message: "no resource folder".into() })?,
    };
    let host = Host::start(Config { name: name.clone(), node: exe_dir.join("node"), script: resources.join("core.mjs"), home, timeout: Duration::from_millis(timeout_ms), app: app.clone() });
    // A page that loads again starts its core again. The old host stops first, so its sidecar does not stay behind.
    if let Some(old) = hosts.0.lock().unwrap().insert(name, Arc::clone(&host)) {
        old.stop();
    }
    let waiter = Arc::clone(&host);
    let generation = tauri::async_runtime::spawn_blocking(move || waiter.wait_ready(0, Duration::from_secs(20))).await.map_err(|e| CallError { code: "FAILED".into(), message: e.to_string() })?;
    if generation == 0 {
        return Err(CallError { code: "FAILED".into(), message: "the sidecar did not become ready in 20 s".into() });
    }
    Ok(generation)
}

/// One call to the sidecar. The answer is the raw JSON text of the sidecar's value, so the page sees the bytes the sidecar sent.
#[tauri::command]
async fn core_call(hosts: State<'_, Hosts>, name: String, method: String, args: Value) -> Result<String, CallError> {
    let host = host_of(&hosts, &name)?;
    tauri::async_runtime::spawn_blocking(move || host.call(&method, &args)).await.map_err(|e| CallError { code: "FAILED".into(), message: e.to_string() })?
}

/// Test only: ends the sidecar with SIGKILL.
#[tauri::command]
fn core_kill(hosts: State<'_, Hosts>, name: String) -> Result<Option<u32>, CallError> {
    Ok(host_of(&hosts, &name)?.kill())
}

#[tauri::command]
async fn core_wait_ready(hosts: State<'_, Hosts>, name: String, after: u64) -> Result<u64, CallError> {
    let host = host_of(&hosts, &name)?;
    tauri::async_runtime::spawn_blocking(move || host.wait_ready(after, Duration::from_secs(30))).await.map_err(|e| CallError { code: "FAILED".into(), message: e.to_string() })
}

#[tauri::command]
fn core_info(hosts: State<'_, Hosts>, name: String) -> Result<Info, CallError> {
    Ok(host_of(&hosts, &name)?.info())
}

#[tauri::command]
fn write_result(args: State<'_, Args>, contents: String) -> Result<(), String> {
    let out = args.out.clone().ok_or("no --out")?;
    std::fs::write(out, contents).map_err(|e| e.to_string())
}

/// Test only: writes the shell's process id and the sidecar's, so a test can end the shell in a chosen way.
#[tauri::command]
fn report_pids(args: State<'_, Args>, hosts: State<'_, Hosts>, name: String) -> Result<(), String> {
    let out = args.out.clone().ok_or("no --out")?;
    let child = host_of(&hosts, &name).map_err(|e| e.message)?.pid();
    std::fs::write(out, serde_json::json!({ "mainPid": std::process::id(), "childPid": child, "ready": true }).to_string()).map_err(|e| e.to_string())
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

/// Test only: makes the shell fault.
#[tauri::command]
fn crash_app() {
    std::process::abort();
}

/// The close guard: while the page has switched it on, a request to close the window is held and the page is told, so it can ask the person.
#[derive(Default)]
struct CloseGuard(AtomicBool);

#[tauri::command]
fn set_close_guard(guard: State<'_, CloseGuard>, on: bool) {
    guard.0.store(on, Ordering::SeqCst);
}

/// The person said "Leave": the guard is off and the window closes.
#[tauri::command]
fn close_window(app: AppHandle, guard: State<'_, CloseGuard>) {
    guard.0.store(false, Ordering::SeqCst);
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.close();
    }
}

/// Test build only: the answer of the test-only dialog switch. It stands in for the folder chooser. The folders to pick come from the environment, one per call in
/// order, and the last one repeats. It also gives the home folder and the folder to scan. It is compiled only with the `e2e` feature.
#[cfg(feature = "e2e")]
#[derive(Default)]
struct PickCounter(AtomicUsize);

#[cfg(feature = "e2e")]
#[tauri::command]
fn pick_folder(counter: State<'_, PickCounter>, advance: bool) -> Value {
    let env = |name: &str| std::env::var(name).unwrap_or_default();
    let picks: Vec<String> = env("SPIKE_E2E_PICKS").split(':').filter(|s| !s.is_empty()).map(|s| s.to_string()).collect();
    let taken = if advance { counter.0.fetch_add(1, Ordering::SeqCst) } else { counter.0.load(Ordering::SeqCst) };
    let at = taken.min(picks.len().saturating_sub(1));
    serde_json::json!({ "picked": picks.get(at), "home": env("SPIKE_E2E_HOME"), "scan": env("SPIKE_E2E_SCAN") })
}

fn stop_all(app: &AppHandle) {
    let hosts = app.state::<Hosts>();
    let list: Vec<Arc<Host>> = hosts.0.lock().unwrap().values().cloned().collect();
    for host in list {
        host.stop();
    }
}

fn main() {
    let builder = tauri::Builder::default();
    // The WebdriverIO plugin and the embedded WebDriver server: test build only.
    #[cfg(feature = "e2e")]
    let builder = builder
        .plugin(tauri_plugin_wdio::init())
        .plugin(tauri_plugin_wdio_webdriver::init())
        .manage(PickCounter::default())
        .invoke_handler(tauri::generate_handler![app_args, core_start, core_call, core_kill, core_wait_ready, core_info, write_result, report_pids, quit_app, crash_app, set_close_guard, close_window, pick_folder]);
    #[cfg(not(feature = "e2e"))]
    let builder = builder.invoke_handler(tauri::generate_handler![app_args, core_start, core_call, core_kill, core_wait_ready, core_info, write_result, report_pids, quit_app, crash_app, set_close_guard, close_window]);
    builder
        .manage(Hosts::default())
        .manage(parse_args())
        .manage(CloseGuard::default())
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.state::<CloseGuard>().0.load(Ordering::SeqCst) {
                    api.prevent_close();
                    let _ = window.emit("close-guard", ());
                }
            }
        })
        .setup(|app| {
            // No dock icon and no menu bar: the app is an agent of the test and shows nothing.
            // Only a test scenario hides the app. Started with no scenario, as the smoke check starts it, the app is a normal app with a window.
            #[cfg(target_os = "macos")]
            if app.state::<Args>().scenario.is_some() {
                app.set_activation_policy(tauri::ActivationPolicy::Prohibited);
            }
            let _ = app;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building the spike shell")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                stop_all(app);
            }
        });
}
