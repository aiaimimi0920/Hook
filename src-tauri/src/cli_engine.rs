// CLI Engine Module - Execute Art via Command Line Interface
// Replaces Python wrapper for simple CLI tools

use crate::process_utils::configure_child_no_window;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use image::DynamicImage;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::{Command, Stdio};

#[tauri::command]
pub fn native_cli_execute(
    art_id: String,
    input_base64: String,
    params: std::collections::HashMap<String, serde_json::Value>,
) -> Result<serde_json::Value, String> {
    println!("Backend: native_cli_execute called for {}", art_id);

    // 1. Read Art Definition to get Command Template
    let config_dir = dirs::config_dir().ok_or("Config dir not found")?;
    let arts_path = config_dir.join("ArtNexus").join("arts.json");
    let content = std::fs::read_to_string(&arts_path).map_err(|e| e.to_string())?;
    // We need access to mock_artloom definitions.
    // Since mock_artloom is a module in lib.rs, we can access it via crate::mock_artloom
    let arts: Vec<crate::mock_artloom::ArtDefinition> =
        serde_json::from_str(&content).map_err(|e| e.to_string())?;

    let art = arts
        .iter()
        .find(|a| a.id == art_id)
        .ok_or("Art not found")?;
    let exec = art.execution.as_ref().ok_or("No execution config")?;
    let command_template = exec
        .get("command")
        .and_then(|v| v.as_str())
        .ok_or("No command template")?;

    // 2. Decode Input Image
    let base64_data = input_base64.split(",").last().unwrap_or(&input_base64);
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(base64_data)
        .map_err(|e| e.to_string())?;
    let img = image::load_from_memory(&bytes).map_err(|e| e.to_string())?;

    // 3. Execute via CliEngine
    let engine = CliEngine::new();
    let result = engine.process_image(
        &img,
        command_template,
        &params,
        &art.params.iter().map(|p| serde_json::json!(p)).collect(),
    );

    serde_json::to_value(result).map_err(|e| e.to_string())
}

/// Result of CLI Art processing
#[derive(Debug, Serialize, Deserialize)]
pub struct CliProcessResult {
    pub success: bool,
    pub output_base64: Option<String>,
    pub output_path: Option<String>,
    pub processing_time_ms: u64,
    pub error: Option<String>,
}

pub struct CliEngine {
    base_dir: PathBuf,
}

impl CliEngine {
    pub fn new() -> Self {
        let exe_path = std::env::current_exe().unwrap_or_default();
        let base_dir = exe_path.parent().unwrap_or(&exe_path).to_path_buf();
        Self { base_dir }
    }

    /// Execute a CLI command based on Art definition
    pub fn execute_art(
        &self,
        command_template: &str,
        params: &HashMap<String, serde_json::Value>,
        input_path: &PathBuf,
        output_path: &PathBuf,
        param_defs: &Vec<serde_json::Value>, // Needed for arg_true/arg_false
    ) -> Result<String, String> {
        // 1. Parameter Substitution
        let mut final_cmd = command_template.to_string();

        // Replace system placeholders
        // IMPORTANT: Double-brace {{}} must be replaced BEFORE single-brace {}
        // to avoid partial matching that leaves orphan braces
        final_cmd = final_cmd.replace("{{input}}", &input_path.to_string_lossy());
        final_cmd = final_cmd.replace("{{output}}", &output_path.to_string_lossy());
        final_cmd = final_cmd.replace("{input}", &input_path.to_string_lossy());
        final_cmd = final_cmd.replace("{output}", &output_path.to_string_lossy());

        // Replace user parameters
        for (key, value) in params {
            let placeholder = format!("{{{}}}", key);
            let placeholder_double = format!("{{{{{}}}}}", key);

            // Support for {{-key}} and {{--key}} boolean flag patterns
            let placeholder_bool_single = format!("{{{{-{}}}}}", key);
            let placeholder_bool_double = format!("{{{{--{}}}}}", key);

            // 1. Determine Standard Value (s_val)
            let s_val = match value {
                serde_json::Value::String(s) => s.clone(),
                serde_json::Value::Number(n) => n.to_string(),
                serde_json::Value::Bool(b) => {
                    // Check definition for arg_true/arg_false
                    let def = param_defs.iter().find(|d| d["id"] == *key);
                    if let Some(d) = def {
                        if *b {
                            d["arg_true"].as_str().unwrap_or("true").to_string()
                        } else {
                            d["arg_false"].as_str().unwrap_or("false").to_string()
                        }
                    } else {
                        b.to_string()
                    }
                }
                _ => value.to_string(),
            };

            // 2. Determine Flag Values (flag_val_single/double)
            // Used when template strictly asks for {{-key}} or {{--key}}
            let (flag_val_single, flag_val_double) = match value {
                serde_json::Value::Bool(b) => {
                    if *b {
                        (format!("-{}", key), format!("--{}", key))
                    } else {
                        (String::new(), String::new())
                    }
                }
                serde_json::Value::String(s) => (s.clone(), s.clone()),
                _ => (s_val.clone(), s_val.clone()),
            };

            // IMPORTANT: Replace double-brace {{key}} BEFORE single-brace {key}
            // Otherwise {key} matches inside {{key}}, leaving orphan braces
            final_cmd = final_cmd.replace(&placeholder_double, &s_val);
            final_cmd = final_cmd.replace(&placeholder, &s_val);
            final_cmd = final_cmd.replace(&placeholder_bool_double, &flag_val_double);
            final_cmd = final_cmd.replace(&placeholder_bool_single, &flag_val_single);
        }

        // Cleanup remaining placeholders (optional, maybe warn?)

        println!("[CliEngine] Executing: {}", final_cmd);

        // 2. Parse Command String (Simple splitting, handling quotes)
        // Note: usage of 'shlex' crate would be better but keeping deps minimal
        // Minimal quote handling:
        let args = self.parse_cmd_args(&final_cmd);

        if args.is_empty() {
            return Err("Empty command".to_string());
        }

        let prog = &args[0];
        let prog_args = &args[1..];

        // 3. Execute
        let mut command = Command::new(prog);
        let output = configure_child_no_window(
            command
                .args(prog_args)
                .current_dir(&self.base_dir)
                .stdout(Stdio::piped())
                .stderr(Stdio::piped()),
        )
        .output()
        .map_err(|e| format!("Failed to spawn process '{}': {}", prog, e))?;

        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);

        if !output.status.success() {
            println!("[CliEngine] Command failed: {}", stderr);
            // Pingo might return non-zero but still work?
            // Trust output file existence caller check.
        }

        Ok(format!("Stdout: {}\nStderr: {}", stdout, stderr))
    }

    // Rudimentary shell argument parser
    fn parse_cmd_args(&self, cmd: &str) -> Vec<String> {
        let mut args = Vec::new();
        let mut current = String::new();
        let mut in_quote = false;

        for c in cmd.chars() {
            if c == '"' {
                in_quote = !in_quote;
            } else if c == ' ' && !in_quote {
                if !current.is_empty() {
                    args.push(current.clone());
                    current.clear();
                }
            } else {
                current.push(c);
            }
        }
        if !current.is_empty() {
            args.push(current);
        }
        args
    }

    /// Process Image via CLI
    pub fn process_image(
        &self,
        img: &DynamicImage,
        command_template: &str,
        params: &HashMap<String, serde_json::Value>,
        param_defs: &Vec<serde_json::Value>,
    ) -> CliProcessResult {
        let start = std::time::Instant::now();

        // 1. Setup Temp Files
        let temp_dir = std::env::temp_dir().join("artloom_cli");
        if let Err(e) = std::fs::create_dir_all(&temp_dir) {
            return CliProcessResult {
                success: false,
                output_base64: None,
                output_path: None,
                processing_time_ms: 0,
                error: Some(format!("Temp dir error: {}", e)),
            };
        }
        let req_id = uuid::Uuid::new_v4();
        let input_path = temp_dir.join(format!("{}_in.png", req_id));
        let output_path = temp_dir.join(format!("{}_out.png", req_id)); // Pingo optimizes in place or to new?
                                                                        // Note: Pingo optimizes in place unless copied.
                                                                        // Our 'command' handles the logic. We provide {input} and {output}.
                                                                        // If the tool only takes one arg (in-place), the user must write command: "tool {output}"
                                                                        // and we ensure we copy source to output first?
                                                                        // Let's assume standard behavior: Input file exists. Output file is expected to exist after.

        // Save Input
        if let Err(e) = img.save(&input_path) {
            return CliProcessResult {
                success: false,
                output_base64: None,
                output_path: None,
                processing_time_ms: 0,
                error: Some(format!("Failed to save input: {}", e)),
            };
        }

        // For tools that modify in-place (like Pingo often does),
        // we might want to pre-copy input to output if the command uses {output} as the target to modify?
        // Or if the command uses {input} and {output} separately.
        // Simple logic: We define {input} (source, readonly ideally) and {output} (destination).
        // If the user command is `pingo {input}`, it modifies input. That's bad for us reusing source.
        // If command is `cp {input} {output} && pingo {output}`, that works.
        // OR we can decide: {input} is the file we provide. {output} is where we READ result.
        // For safety, let's copy input to output_path BEFORE execution if the command only mentions {output}?
        // No, that's magic.
        // Better: We copy input_image to input_path. We expect result at output_path.
        // If the tool works in-place, the art command should be `cp {input} {output} && tool {output}` (shell).
        // BUT we are executing Process directly, not Shell.
        // So we can optionally pre-copy?
        // Let's just provide the paths.
        // Pingo specifically: `pingo [options] file`. It modifies file.
        // So for Pingo, we should pass `output_path` as the argument, and ensure `output_path` HAS the content first.

        // Strategy: Pre-fill output_path with input content?
        // If we do that, we solve "in-place" tools.
        // If we do that for "transform" tools (input -> output), do they overwrite? usually yes.
        // So copying is generally safe/beneficial.
        let _ = std::fs::copy(&input_path, &output_path); // Pre-fill output

        // Execute
        match self.execute_art(
            command_template,
            params,
            &input_path,
            &output_path,
            param_defs,
        ) {
            Ok(_) => {
                // Check if output exists and load it
                if output_path.exists() {
                    match std::fs::read(&output_path) {
                        Ok(bytes) => {
                            let b64 = BASE64.encode(&bytes);
                            CliProcessResult {
                                success: true,
                                output_base64: Some(format!("data:image/png;base64,{}", b64)),
                                output_path: Some(output_path.to_string_lossy().to_string()),
                                processing_time_ms: start.elapsed().as_millis() as u64,
                                error: None,
                            }
                        }
                        Err(e) => CliProcessResult {
                            success: false,
                            output_base64: None,
                            output_path: None,
                            processing_time_ms: 0,
                            error: Some(format!("Read output failed: {}", e)),
                        },
                    }
                } else {
                    CliProcessResult {
                        success: false,
                        output_base64: None,
                        output_path: None,
                        processing_time_ms: 0,
                        error: Some("Output file missing".to_string()),
                    }
                }
            }
            Err(e) => CliProcessResult {
                success: false,
                output_base64: None,
                output_path: None,
                processing_time_ms: 0,
                error: Some(e),
            },
        }
    }
}
