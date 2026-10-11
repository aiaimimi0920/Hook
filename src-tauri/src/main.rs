// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match otter_lib::emergency_watchdog::parse_parent_pid(&args) {
        Ok(Some(parent_pid)) => {
            std::process::exit(otter_lib::emergency_watchdog::run(parent_pid));
        }
        Ok(None) => {}
        Err(error) => {
            eprintln!("failed to start Otter emergency watchdog: {error}");
            std::process::exit(2);
        }
    }
    if args.iter().any(|arg| arg == "--help" || arg == "-h") {
        emit_cli_text(otter_lib::otter_help_text());
        return;
    }
    if args.iter().any(|arg| arg == "--version" || arg == "-V") {
        emit_cli_text(&format!("{}\n", otter_lib::otter_version_text()));
        return;
    }
    if args.iter().any(|arg| arg == "--self-check") {
        match otter_lib::self_check_report_json() {
            Ok(report) => {
                if let Ok(path) = otter_lib::brand_env::var("HOOK_SELF_CHECK_OUTPUT") {
                    if let Err(error) = std::fs::write(&path, &report) {
                        eprintln!("failed to write self-check output to {path}: {error}");
                        std::process::exit(1);
                    }
                }
                println!("{report}");
            }
            Err(error) => {
                eprintln!("failed to generate self-check report: {error}");
                std::process::exit(1);
            }
        }
        return;
    }
    if args.iter().any(|arg| arg == "--loom-brain-plan-smoke") {
        match otter_lib::loom_brain_plan_smoke_report_json() {
            Ok(report) => {
                if let Ok(path) = otter_lib::brand_env::var("HOOK_LOOM_BRAIN_PLAN_OUTPUT") {
                    if let Err(error) = std::fs::write(&path, &report) {
                        eprintln!(
                            "failed to write Loom brain plan smoke output to {path}: {error}"
                        );
                        std::process::exit(1);
                    }
                }
                println!("{report}");
            }
            Err(error) => {
                eprintln!("Loom brain plan smoke failed: {error}");
                std::process::exit(1);
            }
        }
        return;
    }
    if args.iter().any(|arg| arg == "--talk-voice-capture-smoke") {
        match otter_lib::talk_capture_smoke_report_json() {
            Ok(report) => {
                if let Ok(path) = otter_lib::brand_env::var("HOOK_TALK_VOICE_CAPTURE_OUTPUT") {
                    if let Err(error) = std::fs::write(&path, &report) {
                        eprintln!(
                            "failed to write Talk voice capture smoke output to {path}: {error}"
                        );
                        std::process::exit(1);
                    }
                }
                println!("{report}");
            }
            Err(error) => {
                eprintln!("Talk voice capture smoke failed: {error}");
                std::process::exit(1);
            }
        }
        return;
    }

    if args == ["--tile-outputs"] {
        match otter_lib::tile_outputs::enumerate()
            .and_then(|outputs| serde_json::to_string_pretty(&outputs).map_err(|e| e.to_string()))
        {
            Ok(report) => emit_cli_text(&report),
            Err(error) => {
                emit_cli_text(&error);
                std::process::exit(1);
            }
        }
        return;
    }
    if args
        .iter()
        .any(|arg| arg == "--tile" || arg == "--tile-output")
    {
        if let Err(error) = otter_lib::tile_terminal::parse_output_argument(&args)
            .and_then(otter_lib::tile_terminal::run)
        {
            emit_cli_text(&error);
            std::process::exit(1);
        }
        return;
    }
    otter_lib::run()
}

fn emit_cli_text(text: &str) {
    if let Err(error) = otter_lib::write_optional_cli_output("HOOK_CLI_OUTPUT", text) {
        eprintln!("failed to write CLI output: {error}");
        std::process::exit(1);
    }
    print!("{text}");
}
