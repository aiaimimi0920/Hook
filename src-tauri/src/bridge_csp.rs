//! Regression contract: native local integration needs no WebView network grant.
use std::collections::HashMap;
use tauri::utils::config::CspDirectiveSources;

#[test]
fn main_webview_has_only_self_and_native_ipc_connect_sources() {
    let config: tauri::Config = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
    let directives: HashMap<String, CspDirectiveSources> = config.app.security.csp.unwrap().into();
    let sources: Vec<String> = directives["connect-src"].clone().into();
    assert_eq!(sources, ["'self'", "ipc:", "http://ipc.localhost"]);
    for (directive, required) in [
        ("object-src", "'none'"),
        ("frame-src", "'self'"),
        ("base-uri", "'self'"),
    ] {
        let sources: Vec<String> = directives[directive].clone().into();
        assert_eq!(sources, [required]);
    }
}

#[test]
fn boot_profile_cannot_expand_the_static_network_policy() {
    let runtime = include_str!("native/app_runtime.rs");
    assert!(!runtime.contains("allow_configured_bridge"));
    assert!(!runtime.contains("config_mut()"));
}
