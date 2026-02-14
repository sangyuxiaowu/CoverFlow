#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::{Arc, Mutex};
use tauri::Manager;

#[derive(Clone)]
struct PendingOpen(Arc<Mutex<Vec<String>>>);

fn main() {
  let pending_open = PendingOpen(Arc::new(Mutex::new(Vec::new())));

  tauri::Builder::default()
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .manage(pending_open.clone())
    .setup(|app| {
      let args: Vec<String> = std::env::args().collect();
      if let Some(path) = args.iter().find(|arg| arg.to_lowercase().ends_with(".cfj")) {
        let pending_open = app.state::<PendingOpen>().0.clone();
        if let Ok(mut pending) = pending_open.lock() {
          pending.push(path.clone());
        };
      }
      Ok(())
    })
    .on_page_load(move |window, _| {
      let pending_open = window.app_handle().state::<PendingOpen>().0.clone();
      if let Ok(mut pending) = pending_open.lock() {
        for path in pending.drain(..) {
          if let Ok(encoded) = serde_json::to_string(&path) {
            let script = format!(
              "window.__CFJ_PENDING__ = window.__CFJ_PENDING__ || []; window.__CFJ_PENDING__.push({});",
              encoded
            );
            let _ = window.eval(&script);
          }
        }
      };
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
