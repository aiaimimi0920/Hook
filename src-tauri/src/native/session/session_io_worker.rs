// Bound background session I/O before enqueueing work; the document lock still
// provides the single-writer/revision boundary, without blocking Tauri's UI thread.
static SESSION_IO_ACTIVE: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
const MAX_SESSION_IO_WORKERS: usize = 2;

struct SessionIoPermit<'a>(&'a std::sync::atomic::AtomicUsize);

impl<'a> SessionIoPermit<'a> {
    fn acquire(active: &'a std::sync::atomic::AtomicUsize) -> Result<Self, String> {
        active
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |count| {
                (count < MAX_SESSION_IO_WORKERS).then_some(count + 1)
            })
            .map(|_| Self(active))
            .map_err(|_| "SESSION_IO_BUSY retry session I/O later".to_string())
    }
}

impl Drop for SessionIoPermit<'_> {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::AcqRel);
    }
}

struct SessionSaveRequest {
    stickers: Vec<StickerData>,
    links: Vec<LinkData>,
    groups: Option<Vec<serde_json::Value>>,
    recycle_bin: Option<Vec<FrozenStickerEntry>>,
    reference_library: Option<Vec<FrozenStickerEntry>>,
    workflow_asset_archive_hints: Option<WorkflowAssetArchiveHints>,
    expected_document_revision: Option<u64>,
    managed_asset_paths: Option<Vec<String>>,
}

#[cfg(test)]
#[test]
fn session_io_admission_is_bounded_and_released() {
    let active = std::sync::atomic::AtomicUsize::new(0);
    let first = SessionIoPermit::acquire(&active).unwrap();
    let second = SessionIoPermit::acquire(&active).unwrap();
    assert!(SessionIoPermit::acquire(&active).is_err());
    drop(first);
    let replacement = SessionIoPermit::acquire(&active).unwrap();
    drop((second, replacement));
    assert_eq!(active.load(Ordering::Acquire), 0);
}
