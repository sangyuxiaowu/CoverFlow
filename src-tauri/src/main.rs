#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::{Arc, Mutex};
use tauri::Manager;
use tauri_plugin_fs::FsExt;

#[derive(Clone)]
struct PendingOpen(Arc<Mutex<Vec<String>>>);

#[tauri::command]
fn prepare_chat_storage(app: tauri::AppHandle, project_path: String) -> Result<String, String> {
  let project = std::path::PathBuf::from(&project_path);
  if !app.fs_scope().is_allowed(&project) {
    return Err("The project file has not been authorized.".into());
  }
  let project = project.canonicalize().map_err(|error| error.to_string())?;
  if project.extension().and_then(|value| value.to_str()).map(|value| value.eq_ignore_ascii_case("cfj")) != Some(true) {
    return Err("Expected a CoverFlow project file.".into());
  }
  let parent = project.parent().ok_or("The project has no parent directory.")?;
  let chat = parent.join("chat");
  if chat.exists() && chat.canonicalize().map_err(|error| error.to_string())? != chat {
    return Err("A linked chat directory is not allowed.".into());
  }
  std::fs::create_dir_all(&chat).map_err(|error| error.to_string())?;
  app.fs_scope().allow_directory(&chat, true).map_err(|error| error.to_string())?;
  Ok(parent.to_string_lossy().into_owned())
}

fn main() {
  let pending_open = PendingOpen(Arc::new(Mutex::new(Vec::new())));

  tauri::Builder::default()
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .invoke_handler(tauri::generate_handler![prepare_chat_storage])
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
