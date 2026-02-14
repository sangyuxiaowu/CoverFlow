#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Emitter;

fn main() {
  tauri::Builder::default()
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .setup(|app| {
      let args: Vec<String> = std::env::args().collect();
      if let Some(path) = args.iter().find(|arg| arg.to_lowercase().ends_with(".cfj")) {
        let _ = app.emit("open-local-project", path.clone());
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
