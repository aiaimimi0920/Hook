// A non-evicting quota: cached images can be referenced by persisted Units.
use std::fs::{self, File, OpenOptions};
use std::path::{Path, PathBuf};
use tokio::sync::{Semaphore, SemaphorePermit};

const MAX_CACHE_BYTES: u64 = 512 * 1024 * 1024;
const MAX_CACHE_FILES: usize = 1024;
const MAX_DOWNLOAD_BYTES: u64 = 64 * 1024 * 1024;
static DOWNLOADS: Semaphore = Semaphore::const_new(2);

pub(crate) struct Admission {
    _permit: SemaphorePermit<'static>,
    _lock: File,
}

pub(crate) fn reject_link(metadata: &fs::Metadata) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return Err("Image cache reparse points are not supported".into());
        }
    }
    if metadata.file_type().is_symlink() {
        return Err("Image cache links are not supported".into());
    }
    Ok(())
}

fn check_capacity(
    root: &Path,
    max_bytes: u64,
    max_files: usize,
    reserve: u64,
) -> Result<(), String> {
    let mut bytes = 0u64;
    let mut files = 0usize;
    for entry in fs::read_dir(root).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if entry.file_name() == ".quota.lock" {
            continue;
        }
        let metadata = fs::symlink_metadata(entry.path()).map_err(|e| e.to_string())?;
        reject_link(&metadata)?;
        if !metadata.is_file() {
            return Err("Unexpected image cache entry".into());
        }
        bytes = bytes.saturating_add(metadata.len());
        files += 1;
        if files >= max_files || bytes.saturating_add(reserve) > max_bytes {
            return Err("Image cache quota reached; existing Unit assets were preserved".into());
        }
    }
    if reserve > max_bytes {
        return Err("Image cache reservation exceeds quota".into());
    }
    Ok(())
}

fn lock_and_reserve(root: &Path) -> Result<File, String> {
    reject_link(&fs::symlink_metadata(root).map_err(|e| e.to_string())?)?;
    let mut options = OpenOptions::new();
    options.read(true).write(true).create(true).truncate(false);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.custom_flags(0x0020_0000); // FILE_FLAG_OPEN_REPARSE_POINT
    }
    let lock = options
        .open(root.join(".quota.lock"))
        .map_err(|e| e.to_string())?;
    reject_link(&lock.metadata().map_err(|e| e.to_string())?)?;
    fs2::FileExt::try_lock_exclusive(&lock)
        .map_err(|_| "Image cache download is busy".to_string())?;
    // Hold this cross-process lock until the bounded download and write finish.
    check_capacity(root, MAX_CACHE_BYTES, MAX_CACHE_FILES, MAX_DOWNLOAD_BYTES)?;
    Ok(lock)
}

pub(crate) async fn admit(root: PathBuf) -> Result<Admission, String> {
    let permit = DOWNLOADS
        .try_acquire()
        .map_err(|_| "Image cache download is busy".to_string())?;
    let lock = tokio::task::spawn_blocking(move || lock_and_reserve(&root))
        .await
        .map_err(|_| "Image cache quota task failed".to_string())??;
    Ok(Admission {
        _permit: permit,
        _lock: lock,
    })
}

pub(crate) fn write_new(path: &Path, bytes: &[u8]) -> Result<(), String> {
    use std::io::Write;
    if bytes.len() as u64 > MAX_DOWNLOAD_BYTES {
        return Err("Image cache payload exceeds reservation".into());
    }
    if path.exists() {
        return Err("Cached image already exists".into());
    }
    let temporary = path.with_extension(format!("pending-{}", uuid::Uuid::new_v4()));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .map_err(|e| e.to_string())?;
    let result = file
        .write_all(bytes)
        .and_then(|_| file.sync_all())
        .map_err(|e| e.to_string());
    drop(file);
    // Readers never see partial final files. Crash leftovers remain counted against quota.
    let result = result.and_then(|_| fs::rename(&temporary, path).map_err(|e| e.to_string()));
    if result.is_err() {
        let _ = fs::remove_file(temporary);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quota_rejects_growth_without_deleting_referenced_assets() {
        let root = std::env::temp_dir().join(format!("hook-image-quota-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let selected = root.join("selected.png");
        fs::write(&selected, [1u8; 80]).unwrap();
        assert!(check_capacity(&root, 100, 4, 20).is_ok());
        assert!(check_capacity(&root, 100, 4, 21).is_err());
        assert!(check_capacity(&root, 100, 1, 1).is_err());
        assert!(write_new(&selected, &[2]).is_err());
        assert_eq!(fs::read(&selected).unwrap(), [1u8; 80]);
        let lock = lock_and_reserve(&root).unwrap();
        assert!(lock_and_reserve(&root).is_err());
        drop(lock);
        assert!(lock_and_reserve(&root).is_ok());
        fs::remove_dir_all(root).unwrap();
    }
}
