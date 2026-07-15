fn main() {
    println!("cargo:rerun-if-changed=icons/icon.ico");
    println!("cargo:rerun-if-changed=icons/icon.png");
    println!("cargo:rerun-if-changed=tauri.conf.json");
    println!("cargo:rerun-if-changed=windows/uiaccess.manifest.xml");
    println!("cargo:rerun-if-env-changed=HOOK_WINDOWS_UIACCESS");

    let mut attributes = tauri_build::Attributes::new();

    if hook_windows_uiaccess_requested() {
        println!("cargo:rustc-env=HOOK_WINDOWS_UIACCESS_BUILD=1");
        let windows_attributes = tauri_build::WindowsAttributes::new()
            .app_manifest(include_str!("windows/uiaccess.manifest.xml"));
        attributes = attributes.windows_attributes(windows_attributes);
    }

    tauri_build::try_build(attributes).expect("failed to run tauri build script");
}

fn hook_windows_uiaccess_requested() -> bool {
    std::env::var("HOOK_WINDOWS_UIACCESS")
        .map(|value| {
            let normalized = value.trim().to_ascii_lowercase();
            matches!(normalized.as_str(), "1" | "true" | "yes" | "on")
        })
        .unwrap_or(false)
}
