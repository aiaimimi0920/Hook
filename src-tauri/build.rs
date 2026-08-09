fn main() {
    println!("cargo:rerun-if-changed=icons/icon.ico");
    println!("cargo:rerun-if-changed=icons/icon.png");
    println!("cargo:rerun-if-changed=tauri.conf.json");
    println!("cargo:rerun-if-changed=windows/test.manifest.xml");
    println!("cargo:rerun-if-changed=windows/uiaccess.manifest.xml");
    println!("cargo:rerun-if-env-changed=HOOK_WINDOWS_UIACCESS");

    let mut attributes = tauri_build::Attributes::new();

    #[cfg(target_os = "windows")]
    {
        let app_manifest = if hook_windows_uiaccess_requested() {
            println!("cargo:rustc-env=HOOK_WINDOWS_UIACCESS_BUILD=1");
            include_str!("windows/uiaccess.manifest.xml")
        } else {
            include_str!("windows/test.manifest.xml")
        };
        let windows_attributes = tauri_build::WindowsAttributes::new().app_manifest(app_manifest);
        attributes = attributes.windows_attributes(windows_attributes);
    }

    #[cfg(not(target_os = "windows"))]
    if hook_windows_uiaccess_requested() {
        println!("cargo:rustc-env=HOOK_WINDOWS_UIACCESS_BUILD=1");
    }

    tauri_build::try_build(attributes).expect("failed to run tauri build script");

    #[cfg(target_os = "windows")]
    {
        let resource_lib =
            std::path::Path::new(&std::env::var("OUT_DIR").expect("Cargo OUT_DIR is required"))
                .join("resource.lib");
        let test_resource_lib = resource_lib.with_file_name("hook_test_manifest.lib");
        std::fs::copy(&resource_lib, &test_resource_lib)
            .expect("failed to prepare Windows test manifest resource");
        println!(
            "cargo:rustc-link-search=native={}",
            test_resource_lib
                .parent()
                .expect("Windows resource output directory")
                .display()
        );
    }
}

fn hook_windows_uiaccess_requested() -> bool {
    std::env::var("HOOK_WINDOWS_UIACCESS")
        .map(|value| {
            let normalized = value.trim().to_ascii_lowercase();
            matches!(normalized.as_str(), "1" | "true" | "yes" | "on")
        })
        .unwrap_or(false)
}
