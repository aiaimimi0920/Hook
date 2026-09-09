// Regions own input independently; window visibility has one shared snapshot and lease count.
#[cfg(target_os = "windows")]
#[derive(Debug, Default)]
struct LiveSourceVisibility {
    snapshot: Option<LiveSourceWindowSnapshot>,
    logically_hidden: bool,
    logical_hide_reason: Option<String>,
    sessions: usize,
}

#[cfg(target_os = "windows")]
fn acquire_live_source_visibility(
    hwnd: isize,
    process_id: u32,
    thread_id: u32,
) -> Result<Arc<Mutex<LiveSourceVisibility>>, String> {
    type Identity = (isize, u32, u32);
    type Registry = Mutex<HashMap<Identity, std::sync::Weak<Mutex<LiveSourceVisibility>>>>;
    static REGISTRY: std::sync::OnceLock<Registry> = std::sync::OnceLock::new();
    let mut registry = REGISTRY.get_or_init(Mutex::default).lock()
        .map_err(|_| "live source visibility registry poisoned".to_string())?;
    registry.retain(|_, source| source.strong_count() > 0);
    let key = (hwnd, process_id, thread_id);
    let visibility = registry.get(&key).and_then(std::sync::Weak::upgrade)
        .unwrap_or_else(|| Arc::new(Mutex::new(LiveSourceVisibility::default())));
    visibility.lock().map_err(|_| "live source visibility poisoned".to_string())?.sessions += 1;
    registry.insert(key, Arc::downgrade(&visibility));
    Ok(visibility)
}

#[cfg(target_os = "windows")]
impl Drop for LiveSourceWindowLifecycle {
    fn drop(&mut self) {
        // Explicit stop releases a lease once; failed starts and dropped owners do so too.
        let _ = self.restore();
    }
}
