#[cfg(test)]
mod ocr_migration_tests {
    use super::*;

    fn test_root(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "hook-{name}-{}-{}",
            std::process::id(),
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos(),
        ))
    }

    fn sticker(id: &str, legacy: bool, migrated: bool) -> StickerData {
        serde_json::from_value(serde_json::json!({
            "id": id,
            "src": "image.png",
            "x": 0,
            "y": 0,
            "w": 100,
            "h": 100,
            "ocrResult": legacy.then(|| serde_json::json!({ "fullText": "old", "textBlocks": [] })),
            "extensionState": migrated.then(|| serde_json::json!({
                "schemaVersion": 1,
                "revision": 1,
                "attachments": [{
                    "attachmentId": "neuro.official/ocr.result",
                    "typeId": "neuro.official/ocr.result.v1",
                    "schemaVersion": "1",
                    "revision": 1,
                    "pluginId": "neuro.official/ocr",
                    "pluginVersion": "1.0.0",
                    "rendererId": "neuro.official/ocr.result-overlay",
                    "payload": {
                        "migration": { "source": "hook.unitData.ocrResult", "version": 1 }
                    },
                    "resourceRefs": []
                }]
            }))
        })).expect("valid sticker fixture")
    }

    fn session(revision: u64, sticker: StickerData) -> SessionData {
        SessionData {
            document_schema_version: SESSION_DOCUMENT_SCHEMA_VERSION,
            document_revision: revision,
            stickers: vec![sticker],
            links: Vec::new(),
            groups: Vec::new(),
            recycle_bin: Vec::new(),
            reference_library: Vec::new(),
            workflow_asset_archive_index: WorkflowAssetArchiveIndex::default(),
        }
    }

    fn legacy_session_fixture() -> SessionData {
        deserialize_session_document(include_bytes!(
            "../../../../__tests__/fixtures/session/legacy-ocr-barcode-session.json"
        ))
        .expect("persisted legacy session fixture")
    }

    fn migrated_session(source: &SessionData) -> SessionData {
        let mut migrated = source.clone();
        migrated.document_revision = source.document_revision + 1;
        for sticker in &mut migrated.stickers {
            sticker.ocr_result = None;
            sticker.barcode_result = None;
            sticker.extension_state = Some(serde_json::json!({
                "schemaVersion": 1,
                "revision": 2,
                "attachments": [{
                    "attachmentId": "neuro.official/ocr.result",
                    "typeId": "neuro.official/ocr.result.v1",
                    "schemaVersion": "1",
                    "revision": 1,
                    "pluginId": "neuro.official/ocr",
                    "pluginVersion": "1.0.0",
                    "rendererId": "neuro.official/ocr.result-overlay",
                    "payload": {
                        "migration": { "source": "hook.unitData.ocrResult", "version": 1 }
                    },
                    "resourceRefs": []
                }, {
                    "attachmentId": "neuro.official/ocr.codes",
                    "typeId": "neuro.official/ocr.codes.v1",
                    "schemaVersion": "1",
                    "revision": 1,
                    "pluginId": "neuro.official/ocr",
                    "pluginVersion": "1.1.0",
                    "rendererId": "neuro.official/ocr.codes-overlay",
                    "payload": {
                        "migration": { "source": "hook.unitData.barcodeResult", "version": 1 }
                    },
                    "resourceRefs": []
                }]
            }));
        }
        migrated
    }

    #[test]
    fn migration_backup_is_committed_and_can_restore_the_exact_legacy_session() {
        let root = test_root("ocr-migration-rollback");
        fs::create_dir_all(&root).unwrap();
        let source = legacy_session_fixture();
        let migrated = migrated_session(&source);
        write_session_document_atomically(&root.join("session.json"), &source).unwrap();

        assert!(prepare_ocr_migration_backup(&root, &source, &migrated.stickers).unwrap());
        write_session_document_atomically(&root.join("session.json"), &migrated).unwrap();
        finalize_ocr_migration_backup(&root, 1).unwrap();
        let result = rollback_ocr_attachment_migration_file(&root, Some(1)).unwrap();
        let restored = deserialize_session_document(&fs::read(root.join("session.json")).unwrap()).unwrap();

        assert_eq!(result.document_revision, 2);
        assert!(restored.stickers[0].ocr_result.is_some());
        assert!(restored.stickers[0].barcode_result.is_some());
        assert!(restored.stickers[0].extension_state.is_none());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn backup_failure_prevents_the_migration_save_boundary_from_starting() {
        let root = test_root("ocr-migration-backup-failure");
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join(OCR_MIGRATION_DIR), b"not a directory").unwrap();
        let source = session(2, sticker("sticker-1", true, false));
        let incoming = sticker("sticker-1", false, true);

        let error = prepare_ocr_migration_backup(&root, &source, &[incoming]).unwrap_err();

        assert!(error.contains("backup directory"));
        assert!(!root.join("session.json").exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn rollback_refuses_to_replace_a_session_changed_after_migration() {
        let root = test_root("ocr-migration-stale-rollback");
        fs::create_dir_all(&root).unwrap();
        let source = session(3, sticker("sticker-1", true, false));
        let migrated = session(4, sticker("sticker-1", false, true));
        write_session_document_atomically(&root.join("session.json"), &source).unwrap();
        prepare_ocr_migration_backup(&root, &source, &migrated.stickers).unwrap();
        finalize_ocr_migration_backup(&root, 4).unwrap();
        let later = session(5, sticker("sticker-1", false, true));
        write_session_document_atomically(&root.join("session.json"), &later).unwrap();

        let error = rollback_ocr_attachment_migration_file(&root, Some(5)).unwrap_err();
        let retained = deserialize_session_document(&fs::read(root.join("session.json")).unwrap()).unwrap();

        assert!(error.contains("ROLLBACK_STALE"));
        assert_eq!(retained.document_revision, 5);
        assert!(retained.stickers[0].ocr_result.is_none());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn migration_backup_failures_leave_the_real_legacy_session_untouched() {
        for fault in [
            AtomicSessionWriteFault::DiskFull,
            AtomicSessionWriteFault::SyncFailure,
            AtomicSessionWriteFault::ReplaceFailure,
        ] {
            let root = test_root(&format!("ocr-migration-{fault:?}"));
            fs::create_dir_all(&root).unwrap();
            let source = legacy_session_fixture();
            let migrated = migrated_session(&source);
            let session_path = root.join("session.json");
            write_session_document_atomically(&session_path, &source).unwrap();

            let error = prepare_ocr_migration_backup_with_fault(
                &root,
                &source,
                &migrated.stickers,
                Some(fault),
            )
            .unwrap_err();
            let retained = deserialize_session_document(&fs::read(&session_path).unwrap()).unwrap();
            let (backup_path, journal_path) = migration_paths(&root);

            assert!(error.contains("Injected"));
            assert!(retained.stickers[0].ocr_result.is_some());
            assert!(retained.stickers[0].barcode_result.is_some());
            assert!(!backup_path.exists());
            assert!(!journal_path.exists());
            let leftovers = fs::read_dir(backup_path.parent().unwrap())
                .unwrap()
                .filter_map(Result::ok)
                .collect::<Vec<_>>();
            assert!(leftovers.is_empty(), "temporary migration files must be removed");
            let _ = fs::remove_dir_all(root);
        }
    }

    const OCR_MIGRATION_CRASH_ROOT_ENV: &str = "HOOK_TEST_OCR_MIGRATION_CRASH_ROOT";

    #[test]
    fn ocr_migration_forced_crash_child() {
        let Some(root) = std::env::var_os(OCR_MIGRATION_CRASH_ROOT_ENV).map(PathBuf::from) else {
            return;
        };
        let session_path = root.join("session.json");
        let source = deserialize_session_document(&fs::read(&session_path).unwrap()).unwrap();
        let migrated = migrated_session(&source);
        prepare_ocr_migration_backup(&root, &source, &migrated.stickers).unwrap();
        write_session_document_atomically(&session_path, &migrated).unwrap();
        std::process::exit(73);
    }

    #[test]
    fn prepared_journal_survives_forced_exit_and_restores_on_restart() {
        let root = test_root("ocr-migration-forced-exit");
        fs::create_dir_all(&root).unwrap();
        let source = legacy_session_fixture();
        write_session_document_atomically(&root.join("session.json"), &source).unwrap();

        let status = std::process::Command::new(std::env::current_exe().unwrap())
            .arg("ocr_migration_forced_crash_child")
            .arg("--nocapture")
            .arg("--test-threads=1")
            .env(OCR_MIGRATION_CRASH_ROOT_ENV, &root)
            .status()
            .expect("spawn forced-crash migration helper");

        assert_eq!(status.code(), Some(73));
        let (_, journal_path) = migration_paths(&root);
        assert_eq!(load_migration_journal(&journal_path).unwrap().unwrap().status, "prepared");
        let result = rollback_ocr_attachment_migration_file(&root, Some(1)).unwrap();
        let restored = deserialize_session_document(&fs::read(root.join("session.json")).unwrap()).unwrap();
        assert_eq!(result.document_revision, 2);
        assert!(restored.stickers[0].ocr_result.is_some());
        assert!(restored.stickers[0].barcode_result.is_some());
        assert_eq!(load_migration_journal(&journal_path).unwrap().unwrap().status, "rolledBack");
        let _ = fs::remove_dir_all(root);
    }
}
