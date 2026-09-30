//! Separate Tauri runtime: no capture hooks, cursor replacement, tray or source listener.
use crate::tile_outputs::{self, TileOutput};
use crate::wall_live::WallMediaFormat;
use std::sync::Mutex;
use tauri::{Manager, PhysicalPosition, PhysicalSize};

struct OutputBinding {
    output_id: Option<String>,
    last: Mutex<Option<TileOutput>>,
    media_format: WallMediaFormat,
}

#[tauri::command]
fn tile_list_outputs() -> Result<Vec<TileOutput>, String> {
    tile_outputs::enumerate()
}

#[tauri::command]
fn tile_output_info(
    app: tauri::AppHandle,
    binding: tauri::State<'_, OutputBinding>,
) -> Result<TileOutput, String> {
    let id = binding
        .output_id
        .as_deref()
        .ok_or("tile_output_not_bound")?;
    let window = app
        .get_webview_window("main")
        .ok_or("tile_window_missing")?;
    let mut last = binding
        .last
        .lock()
        .map_err(|_| "tile_binding_unavailable")?;
    let outputs = match tile_outputs::enumerate() {
        Ok(outputs) => outputs,
        Err(error) => {
            let _ = window.hide();
            *last = None;
            return Err(error);
        }
    };
    let output = outputs.into_iter().find(|o| o.output_id == id);
    let Some(output) = output else {
        let _ = window.hide();
        *last = None;
        return Err("tile_output_disconnected".into());
    };
    if last.as_ref() != Some(&output) {
        window
            .set_position(PhysicalPosition::new(output.x, output.y))
            .map_err(|_| "tile_position_failed")?;
        window
            .set_size(PhysicalSize::new(output.width, output.height))
            .map_err(|_| "tile_size_failed")?;
        window.show().map_err(|_| "tile_show_failed")?;
        *last = Some(output.clone());
    }
    Ok(output)
}

#[tauri::command]
fn tile_launch_output(
    output_id: String,
    format: WallMediaFormat,
    binding: tauri::State<'_, OutputBinding>,
) -> Result<(), String> {
    if binding.output_id.is_some() {
        return Err("tile_control_required".into());
    }
    if !tile_outputs::enumerate()?
        .iter()
        .any(|o| o.output_id == output_id)
    {
        return Err("tile_output_not_found".into());
    }
    let exe = std::env::current_exe().map_err(|_| "tile_executable_unavailable")?;
    let mut command = std::process::Command::new(exe);
    command
        .arg("--tile-output")
        .arg(output_id)
        .env("HOOK_TILE_MEDIA_FORMAT", format.as_str());
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    command.spawn().map_err(|_| "tile_launch_failed")?;
    Ok(())
}

#[tauri::command]
fn tile_exit(app: tauri::AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn tile_media_mode(binding: tauri::State<'_, OutputBinding>) -> WallMediaFormat {
    binding.media_format
}

pub fn run(output_id: Option<String>) -> Result<(), String> {
    let media_format = match std::env::var("HOOK_TILE_MEDIA_FORMAT").as_deref() {
        Ok("raw_bgra") | Err(std::env::VarError::NotPresent) => WallMediaFormat::RawBgra,
        Ok("png") => WallMediaFormat::Png,
        _ => return Err("tile_media_format_invalid".into()),
    };
    let name = format!(
        "Local\\ArtNexus.Hook.Tile.{}",
        output_id.as_deref().unwrap_or("control")
    );
    let _guard = crate::single_instance::try_acquire_single_instance(&name)?
        .ok_or("tile_output_already_running")?;
    if let Some(id) = &output_id {
        if !tile_outputs::enumerate()?
            .iter()
            .any(|o| &o.output_id == id)
        {
            return Err("tile_output_not_found".into());
        }
    }
    crate::configure_webview2_video_safe_composition();
    let mut context = tauri::generate_context!();
    context.config_mut().app.windows.clear();
    let output_mode = output_id.is_some();
    let app = tauri::Builder::default()
        .manage(OutputBinding {
            output_id,
            last: Mutex::new(None),
            media_format,
        })
        .invoke_handler(tauri::generate_handler![
            tile_list_outputs,
            tile_output_info,
            tile_launch_output,
            tile_exit,
            tile_media_mode,
            crate::wall_client::wall_request,
            crate::wall_live::wall_live_open,
            crate::wall_live::wall_live_read,
            crate::wall_live::wall_live_close,
            crate::wall_live::wall_live_stats
        ])
        .setup(move |app| {
            let fragment = if output_mode {
                "index.html#tile-output"
            } else {
                "index.html#tile"
            };
            let window = tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::App(fragment.into()),
            )
            .title("Hook Tile")
            .inner_size(760.0, 560.0)
            .visible(!output_mode)
            .decorations(!output_mode)
            .transparent(false)
            .resizable(!output_mode)
            .shadow(!output_mode)
            .background_color(tauri::window::Color(6, 8, 13, 255))
            .build()?;
            if output_mode {
                let _ = tile_output_info(app.handle().clone(), app.state());
            } else {
                window.show()?;
            }
            Ok(())
        })
        .build(context)
        .map_err(|_| "tile_runtime_build_failed")?;
    app.run(|_, _| {});
    Ok(())
}

pub fn parse_output_argument(args: &[String]) -> Result<Option<String>, String> {
    if args == ["--tile"] {
        return Ok(None);
    }
    if args.len() == 2
        && args[0] == "--tile-output"
        && args[1].len() == 72
        && args[1].starts_with("monitor-")
        && args[1][8..].bytes().all(|c| c.is_ascii_hexdigit())
    {
        return Ok(Some(args[1].clone()));
    }
    Err("usage: Hook --tile | --tile-output monitor-<64 hex digits>".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cli_rejects_extra_arguments_and_unbounded_output_names() {
        assert_eq!(parse_output_argument(&["--tile".into()]).unwrap(), None);
        assert!(parse_output_argument(&["--tile-output".into()]).is_err());
        assert!(parse_output_argument(&["--tile".into(), "--capture".into()]).is_err());
        assert!(parse_output_argument(&[
            "--tile-output".into(),
            format!("monitor-{}", "a".repeat(64))
        ])
        .is_ok());
        assert!(parse_output_argument(&["--tile-output".into(), "../unsafe".into()]).is_err());
    }
}
