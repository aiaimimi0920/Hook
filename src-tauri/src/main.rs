// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.iter().any(|arg| arg == "--help" || arg == "-h") {
        emit_cli_text(hook_lib::hook_help_text());
        return;
    }
    if args.iter().any(|arg| arg == "--version" || arg == "-V") {
        emit_cli_text(&format!("{}\n", hook_lib::hook_version_text()));
        return;
    }
    if args.iter().any(|arg| arg == "--self-check") {
        match hook_lib::self_check_report_json() {
            Ok(report) => {
                if let Ok(path) = std::env::var("HOOK_SELF_CHECK_OUTPUT") {
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
        match hook_lib::loom_brain_plan_smoke_report_json() {
            Ok(report) => {
                if let Ok(path) = std::env::var("HOOK_LOOM_BRAIN_PLAN_OUTPUT") {
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
        match hook_lib::talk_capture_smoke_report_json() {
            Ok(report) => {
                if let Ok(path) = std::env::var("HOOK_TALK_VOICE_CAPTURE_OUTPUT") {
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

    hook_lib::run()
}

fn emit_cli_text(text: &str) {
    if let Err(error) = hook_lib::write_optional_cli_output("HOOK_CLI_OUTPUT", text) {
        eprintln!("failed to write CLI output: {error}");
        std::process::exit(1);
    }
    print!("{text}");
}
