//! The smoke-check harness of Gate 3 on macOS. It is a separate app, so the Accessibility permission goes to this app alone and never to the app under test.
//!
//! Commands, all with `--out=FILE` (the result is written there as JSON, because a launch through `open` has no terminal):
//!   dry-run                        reports its bundle id, process ids and whether it holds the permission. It never asks for the permission and makes no accessibility call.
//!   smoke --exe=PATH [--limit-ms]  starts the app at PATH as its own child, waits for a window of that child (one retry), asks it to quit the normal way, and reads its exit code.
//!
//! It probes one process only: the child it started itself. It takes no process id from outside. It has no dependency and opens no socket.

use std::ffi::{c_char, c_void, CString};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    fn AXIsProcessTrusted() -> bool;
    fn AXUIElementCreateApplication(pid: i32) -> *const c_void;
    fn AXUIElementCopyAttributeValue(element: *const c_void, attribute: *const c_void, value: *mut *const c_void) -> i32;
}

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFStringCreateWithCString(alloc: *const c_void, c: *const c_char, encoding: u32) -> *const c_void;
    fn CFStringGetCString(s: *const c_void, buffer: *mut c_char, size: isize, encoding: u32) -> bool;
    fn CFArrayGetCount(array: *const c_void) -> isize;
    fn CFArrayGetValueAtIndex(array: *const c_void, index: isize) -> *const c_void;
    fn CFRelease(object: *const c_void);
    fn CFBundleGetMainBundle() -> *const c_void;
    fn CFBundleGetIdentifier(bundle: *const c_void) -> *const c_void;
}

#[link(name = "AppKit", kind = "framework")]
extern "C" {}

#[link(name = "objc")]
extern "C" {
    fn objc_getClass(name: *const c_char) -> *const c_void;
    fn sel_registerName(name: *const c_char) -> *const c_void;
    fn objc_msgSend();
}

extern "C" {
    fn getppid() -> i32;
}

const UTF8: u32 = 0x0800_0100;

fn cf_string(text: &str) -> *const c_void {
    let c = CString::new(text).expect("no nul");
    unsafe { CFStringCreateWithCString(std::ptr::null(), c.as_ptr(), UTF8) }
}

fn string_of(s: *const c_void) -> String {
    if s.is_null() {
        return String::new();
    }
    let mut buffer = vec![0 as c_char; 1024];
    let ok = unsafe { CFStringGetCString(s, buffer.as_mut_ptr(), buffer.len() as isize, UTF8) };
    if !ok {
        return String::new();
    }
    let bytes: Vec<u8> = buffer.iter().take_while(|c| **c != 0).map(|c| *c as u8).collect();
    String::from_utf8_lossy(&bytes).into_owned()
}

fn json_text(s: &str) -> String {
    let mut out = String::from("\"");
    for ch in s.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

fn arg(name: &str) -> Option<String> {
    std::env::args().find_map(|a| a.strip_prefix(&format!("--{name}=")).map(|s| s.to_string()))
}

fn write_out(json: String) {
    match arg("out") {
        Some(path) => {
            if let Err(error) = std::fs::write(&path, json) {
                eprintln!("could not write {path}: {error}");
            }
        }
        None => println!("{json}"),
    }
}

fn bundle_id() -> String {
    unsafe {
        let bundle = CFBundleGetMainBundle();
        if bundle.is_null() {
            return String::new();
        }
        string_of(CFBundleGetIdentifier(bundle))
    }
}

/// The windows of the child, read through the accessibility API: the number of them, and the title of the first.
fn windows_of(child: &Child) -> (usize, String, i32) {
    unsafe {
        let element = AXUIElementCreateApplication(child.id() as i32);
        if element.is_null() {
            return (0, String::new(), -1);
        }
        let attribute = cf_string("AXWindows");
        let mut value: *const c_void = std::ptr::null();
        let status = AXUIElementCopyAttributeValue(element, attribute, &mut value);
        CFRelease(attribute);
        let mut count = 0usize;
        let mut title = String::new();
        if status == 0 && !value.is_null() {
            count = CFArrayGetCount(value).max(0) as usize;
            if count > 0 {
                let window = CFArrayGetValueAtIndex(value, 0);
                let key = cf_string("AXTitle");
                let mut t: *const c_void = std::ptr::null();
                if AXUIElementCopyAttributeValue(window, key, &mut t) == 0 {
                    title = string_of(t);
                    if !t.is_null() {
                        CFRelease(t);
                    }
                }
                CFRelease(key);
            }
            CFRelease(value);
        }
        CFRelease(element);
        (count, title, status)
    }
}

/// The normal quit request of the operating system: `-[NSRunningApplication terminate]` on the child. It is the request the Quit menu item makes.
fn ask_to_quit(pid: i32) -> bool {
    unsafe {
        let class = objc_getClass(b"NSRunningApplication\0".as_ptr() as *const c_char);
        let by_pid = sel_registerName(b"runningApplicationWithProcessIdentifier:\0".as_ptr() as *const c_char);
        let terminate = sel_registerName(b"terminate\0".as_ptr() as *const c_char);
        let with_pid: extern "C" fn(*const c_void, *const c_void, i32) -> *const c_void = std::mem::transmute(objc_msgSend as *const ());
        let app = with_pid(class, by_pid, pid);
        if app.is_null() {
            return false;
        }
        let call: extern "C" fn(*const c_void, *const c_void) -> i8 = std::mem::transmute(objc_msgSend as *const ());
        call(app, terminate) != 0
    }
}

fn dry_run() {
    let json = format!(
        "{{\"bundleId\":{},\"pid\":{},\"ppid\":{},\"trusted\":{},\"prompted\":false,\"accessibilityCalls\":0}}",
        json_text(&bundle_id()),
        std::process::id(),
        unsafe { getppid() },
        unsafe { AXIsProcessTrusted() }
    );
    write_out(json);
}

fn smoke() {
    let Some(exe) = arg("exe") else {
        write_out("{\"error\":\"no --exe\",\"accessibilityCalls\":0}".into());
        return;
    };
    if !Path::new(&exe).is_file() {
        write_out("{\"error\":\"no such file\",\"accessibilityCalls\":0}".into());
        return;
    }
    let trusted = unsafe { AXIsProcessTrusted() };
    if !trusted {
        write_out("{\"error\":\"accessibility permission is not held\",\"trusted\":false,\"accessibilityCalls\":0}".into());
        return;
    }
    let limit = Duration::from_millis(arg("limit-ms").and_then(|s| s.parse().ok()).unwrap_or(30_000));
    let mut attempts = 0;
    let mut calls = 0u64;
    loop {
        attempts += 1;
        let began = Instant::now();
        let mut child = match Command::new(&exe).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).spawn() {
            Ok(child) => child,
            Err(error) => {
                write_out(format!("{{\"error\":{},\"accessibilityCalls\":{calls}}}", json_text(&format!("could not start: {error}"))));
                return;
            }
        };
        let mut found = (0usize, String::new());
        let mut status = 0;
        while began.elapsed() < limit {
            if let Ok(Some(_)) = child.try_wait() {
                break;
            }
            let (count, title, s) = windows_of(&child);
            calls += 1;
            status = s;
            if count > 0 {
                found = (count, title);
                break;
            }
            std::thread::sleep(Duration::from_millis(250));
        }
        let launch_ms = began.elapsed().as_millis();
        if found.0 == 0 {
            let _ = child.kill();
            let _ = child.wait();
            if attempts < 2 {
                continue;
            }
            write_out(format!("{{\"launched\":true,\"windowFound\":false,\"attempts\":{attempts},\"axStatus\":{status},\"limitMs\":{},\"accessibilityCalls\":{calls}}}", limit.as_millis()));
            return;
        }
        let quit_began = Instant::now();
        let asked = ask_to_quit(child.id() as i32);
        let mut code: Option<i32> = None;
        while quit_began.elapsed() < limit {
            if let Ok(Some(exit)) = child.try_wait() {
                code = Some(exit.code().unwrap_or(-1));
                break;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        let ended = code.is_some();
        if !ended {
            let _ = child.kill();
            let _ = child.wait();
        }
        write_out(format!(
            "{{\"launched\":true,\"windowFound\":true,\"windows\":{},\"windowTitle\":{},\"launchMs\":{launch_ms},\"attempts\":{attempts},\"quitAsked\":{asked},\"quitEnded\":{ended},\"quitMs\":{},\"exitCode\":{},\"limitMs\":{},\"accessibilityCalls\":{calls}}}",
            found.0,
            json_text(&found.1),
            quit_began.elapsed().as_millis(),
            code.map(|c| c.to_string()).unwrap_or_else(|| "null".into()),
            limit.as_millis()
        ));
        return;
    }
}

fn main() {
    match std::env::args().nth(1).as_deref() {
        Some("dry-run") => dry_run(),
        Some("smoke") => smoke(),
        _ => write_out("{\"error\":\"usage: dry-run | smoke --exe=PATH [--limit-ms=N] --out=FILE\"}".into()),
    }
}
