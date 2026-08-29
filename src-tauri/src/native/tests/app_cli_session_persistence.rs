// Verifies session revisions, locking, settings state, and image-asset persistence.

    #[test]
    fn session_library_clear_is_persisted_before_the_control_command_completes() {
        let root = std::env::temp_dir().join(format!(
            "hook-session-library-clear-test-{}-{}",
            std::process::id(),
            file_timestamp_component()
        ));
        std::fs::create_dir_all(&root).expect("create session clear test dir");
        let session_file = root.join("session.json");
        std::fs::write(
            &session_file,
            r#"{"stickers":[],"links":[],"recycleBin":[{"entryId":"r","sourceStickerId":"s","createdAt":"2026-08-09T00:00:00Z","snapshot":{"id":"s","src":"","x":0,"y":0,"w":1,"h":1,"minified":false,"savedRect":null,"cropOffset":null,"opacityNormal":1,"opacityMini":1,"previewSrc":null,"filePath":null,"rasterizedAnnotationLayerSrc":null,"annotationState":null,"imageEditState":null,"captureMeta":null}}],"referenceLibrary":[]}"#,
        )
        .expect("write session clear fixture");

        clear_persisted_session_library_file(&session_file, "clearRecycleBin")
            .expect("clear persisted recycle bin");
        let session: SessionData =
            serde_json::from_slice(&std::fs::read(&session_file).expect("read cleared session"))
                .expect("parse cleared session");

        assert!(session.recycle_bin.is_empty());
        assert_eq!(
            session.document_schema_version,
            SESSION_DOCUMENT_SCHEMA_VERSION
        );
        assert_eq!(session.document_revision, 1);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn session_document_rejects_stale_revision_without_mutating_the_file() {
        let root = std::env::temp_dir().join(format!(
            "hook-session-revision-test-{}-{}",
            std::process::id(),
            file_timestamp_component()
        ));
        std::fs::create_dir_all(&root).expect("create session revision test dir");
        let session_file = root.join("session.json");
        let original =
            br#"{"documentSchemaVersion":1,"documentRevision":7,"stickers":[],"links":[]}"#;
        std::fs::write(&session_file, original).expect("write session revision fixture");

        let session = deserialize_session_document(original).expect("parse current session");
        let error = ensure_expected_session_revision(Some(6), session.document_revision)
            .expect_err("stale revision must fail");

        assert!(error.contains("SESSION_REVISION_CONFLICT"));
        assert_eq!(std::fs::read(&session_file).unwrap(), original);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn session_revision_is_validated_before_image_assets_are_written() {
        let source = include_str!("../session_commands.rs");
        let revision_check = source
            .find("ensure_expected_session_revision")
            .expect("session save must validate its expected revision");
        let first_asset_write = source
            .find("persist_session_image_asset")
            .expect("session save must persist image assets");

        assert!(revision_check < first_asset_write);
    }

    #[test]
    fn history_settings_json_is_atomic_bounded_and_does_not_hide_corruption() {
        let root = std::env::temp_dir().join(format!(
            "hook-history-settings-test-{}-{}",
            std::process::id(),
            file_timestamp_component()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let target = root.join("history.json");

        write_history_settings_json_atomically(&target, br#"{"colors":[]}"#).unwrap();
        write_history_settings_json_atomically(&target, br#"{"screenshots":[]}"#).unwrap();
        let parsed: serde_json::Value =
            serde_json::from_slice(&read_history_settings_json(&target).unwrap()).unwrap();
        assert_eq!(parsed, serde_json::json!({ "screenshots": [] }));

        std::fs::write(&target, b"{ malformed").unwrap();
        let malformed = serde_json::from_slice::<HistoryData>(
            &read_history_settings_json(&target).unwrap(),
        )
        .expect_err("malformed history must not silently become empty history");
        assert!(malformed.is_syntax() || malformed.is_eof());

        let oversized = vec![0u8; HISTORY_SETTINGS_MAX_JSON_BYTES + 1];
        assert!(write_history_settings_json_atomically(&target, &oversized).is_err());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn session_document_rejects_unsupported_schema_without_overwrite() {
        let root = std::env::temp_dir().join(format!(
            "hook-session-schema-test-{}-{}",
            std::process::id(),
            file_timestamp_component()
        ));
        std::fs::create_dir_all(&root).expect("create session schema test dir");
        let session_file = root.join("session.json");
        let original =
            br#"{"documentSchemaVersion":2,"documentRevision":1,"stickers":[],"links":[]}"#;
        std::fs::write(&session_file, original).expect("write unsupported session fixture");

        let error = clear_persisted_session_library_file(&session_file, "clearRecycleBin")
            .expect_err("future schema must not be overwritten");

        assert!(error.contains("SESSION_SCHEMA_UNSUPPORTED"));
        assert_eq!(std::fs::read(&session_file).unwrap(), original);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn session_file_lease_serializes_independent_writers() {
        let root = std::env::temp_dir().join(format!(
            "hook-session-lock-test-{}-{}",
            std::process::id(),
            file_timestamp_component()
        ));
        std::fs::create_dir_all(&root).expect("create session lock test dir");
        let session_file = root.join("session.json");
        let first = SessionFileLease::acquire(&session_file).expect("acquire first lease");
        let second_path = session_file.clone();
        let (sender, receiver) = std::sync::mpsc::channel();
        let waiter = std::thread::spawn(move || {
            let lease = SessionFileLease::acquire(&second_path).expect("acquire second lease");
            sender.send(()).unwrap();
            drop(lease);
        });
        assert!(receiver.recv_timeout(Duration::from_millis(75)).is_err());
        drop(first);
        receiver
            .recv_timeout(Duration::from_secs(1))
            .expect("second writer should acquire after first releases");
        waiter.join().unwrap();
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn app_settings_state_serves_cached_values_and_preserves_them_after_failed_save() {
        let root = std::env::temp_dir().join(format!(
            "hook-app-settings-state-test-{}-{}",
            std::process::id(),
            file_timestamp_component(),
        ));
        let state = AppSettingsState::new(app_settings::AppSettings::default());
        let mut settings = app_settings::AppSettings::default();
        settings.file_naming.drag_export_pattern = "cached_{unitId}".to_string();

        let saved = state.save(&root, settings.clone()).unwrap();
        assert_eq!(state.snapshot().unwrap(), saved);
        std::fs::write(root.join("app-settings.json"), b"{ externally corrupted").unwrap();
        assert_eq!(state.snapshot().unwrap(), saved);

        let mut invalid = settings;
        invalid.file_naming.drag_export_pattern = "{unsupported}".to_string();
        assert!(state.save(&root, invalid).is_err());
        assert_eq!(state.snapshot().unwrap(), saved);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn effective_app_data_dir_uses_current_identifier_dir() {
        let root = std::env::temp_dir().join(format!(
            "hook-app-data-current-test-{}-{}",
            std::process::id(),
            file_timestamp_component()
        ));
        let current_dir = root.join("com.yamiyu.hook");
        std::fs::create_dir_all(&current_dir).expect("create current dir");
        std::fs::write(current_dir.join("history.json"), "{}").expect("write current history");

        let resolved = resolve_effective_app_data_dir(&current_dir);

        let _ = std::fs::remove_dir_all(&root);
        assert_eq!(resolved, current_dir);
    }

    #[test]
    fn effective_app_data_dir_honors_explicit_override_before_current_state() {
        let root = std::env::temp_dir().join(format!(
            "hook-app-data-override-test-{}-{}",
            std::process::id(),
            file_timestamp_component()
        ));
        let current_dir = root.join("com.yamiyu.hook");
        let override_dir = root.join("manual-override");
        std::fs::create_dir_all(&current_dir).expect("create current dir");
        std::fs::create_dir_all(&override_dir).expect("create override dir");
        std::fs::write(current_dir.join("history.json"), "{}").expect("write current history");
        std::fs::write(override_dir.join("session.json"), "{}").expect("write override session");

        let resolved = resolve_effective_app_data_dir_from(&current_dir, Some(&override_dir));

        let _ = std::fs::remove_dir_all(&root);
        assert_eq!(resolved, override_dir);
    }

    #[test]
    fn restore_loaded_session_stickers_keeps_file_backed_srcs_in_path_form() {
        let root = std::env::temp_dir().join(format!(
            "hook-session-restore-test-{}-{}",
            std::process::id(),
            file_timestamp_component()
        ));
        std::fs::create_dir_all(&root).expect("create temp restore dir");
        let image_path = root.join("capture.png");
        std::fs::write(&image_path, [1u8, 2, 3, 4]).expect("write temp image");
        let raw_path = image_path.to_string_lossy().to_string();

        let mut stickers = vec![StickerData {
            id: "restore-1".to_string(),
            src: raw_path.clone(),
            x: 0.0,
            y: 0.0,
            w: 100.0,
            h: 100.0,
            minified: None,
            saved_rect: None,
            crop_offset: None,
            opacity_normal: None,
            opacity_mini: None,
            node_type: None,
            art_id: None,
            params: None,
            file_path: None,
            preview_src: None,
            surface_view_id: None,
            rasterized_annotation_layer_src: None,
            outputs: None,
            ocr_result: None,
            barcode_result: None,
            extension_state: None,
            origin_workflow_id: None,
            origin_node_id: None,
            execution_config: None,
            annotation_state: None,
            image_edit_state: None,
            sticker_edit_propagation: None,
            group_id: None,
            capture_meta: None,
        }];

        restore_loaded_session_stickers(&mut stickers);

        assert_eq!(stickers[0].src, raw_path);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn session_asset_persistence_reuses_the_same_file_for_unchanged_content() {
        let root = std::env::temp_dir().join(format!(
            "hook-session-asset-test-{}-{}",
            std::process::id(),
            file_timestamp_component()
        ));
        std::fs::create_dir_all(&root).expect("create session asset test dir");
        let data_url = tiny_png_data_url_for_test([10, 20, 30]);

        let first = persist_session_image_asset(&root, "sticker-1", "preview", &data_url)
            .expect("first persist should succeed");
        let second = persist_session_image_asset(&root, "sticker-1", "preview", &data_url)
            .expect("second persist should succeed");

        let file_count = std::fs::read_dir(&root)
            .expect("read session asset dir")
            .filter_map(Result::ok)
            .count();
        let _ = std::fs::remove_dir_all(&root);

        assert_eq!(first, second);
        assert_eq!(file_count, 1);
    }

    #[test]
    fn session_asset_persistence_uses_a_new_file_when_content_changes() {
        let root = std::env::temp_dir().join(format!(
            "hook-session-asset-change-test-{}-{}",
            std::process::id(),
            file_timestamp_component()
        ));
        std::fs::create_dir_all(&root).expect("create session asset change test dir");
        let first_data_url = tiny_png_data_url_for_test([10, 20, 30]);
        let second_data_url = tiny_png_data_url_for_test([40, 50, 60]);

        let first = persist_session_image_asset(&root, "sticker-1", "preview", &first_data_url)
            .expect("first persist should succeed");
        let second = persist_session_image_asset(&root, "sticker-1", "preview", &second_data_url)
            .expect("second persist should succeed");

        let _ = std::fs::remove_dir_all(&root);

        assert_ne!(first, second);
    }

    #[test]
    fn session_asset_cleanup_keeps_current_session_references_and_prunes_old_orphans() {
        let root = std::env::temp_dir().join(format!(
            "hook-session-asset-cleanup-test-{}-{}",
            std::process::id(),
            file_timestamp_component()
        ));
        std::fs::create_dir_all(&root).expect("create session asset cleanup test dir");
        let retained_src = persist_session_image_asset(
            &root,
            "sticker-1",
            "source",
            &tiny_png_data_url_for_test([10, 20, 30]),
        )
        .expect("persist retained source");
        let retained_preview = persist_session_image_asset(
            &root,
            "sticker-1",
            "preview",
            &tiny_png_data_url_for_test([40, 50, 60]),
        )
        .expect("persist retained preview");
        let stale_orphan = persist_session_image_asset(
            &root,
            "sticker-2",
            "preview",
            &tiny_png_data_url_for_test([70, 80, 90]),
        )
        .expect("persist stale orphan");
        let fresh_orphan = persist_session_image_asset(
            &root,
            "sticker-3",
            "preview",
            &tiny_png_data_url_for_test([15, 25, 35]),
        )
        .expect("persist fresh orphan");

        let old_time = SystemTime::now()
            - std::time::Duration::from_secs(SESSION_IMAGE_ASSET_RETENTION_SECS + 60);
        set_file_modified_time_for_test(Path::new(&stale_orphan), old_time)
            .expect("age stale orphan");

        let session_data = SessionData {
            document_schema_version: SESSION_DOCUMENT_SCHEMA_VERSION,
            document_revision: 0,
            stickers: vec![StickerData {
                id: "sticker-1".to_string(),
                src: retained_src.clone(),
                x: 0.0,
                y: 0.0,
                w: 100.0,
                h: 100.0,
                minified: None,
                saved_rect: None,
                crop_offset: None,
                opacity_normal: None,
                opacity_mini: None,
                node_type: None,
                art_id: None,
                params: None,
                file_path: None,
                preview_src: Some(retained_preview.clone()),
                surface_view_id: None,
                rasterized_annotation_layer_src: None,
                outputs: None,
                ocr_result: None,
                barcode_result: None,
                extension_state: None,
                origin_workflow_id: None,
                origin_node_id: None,
                execution_config: None,
                annotation_state: None,
                image_edit_state: None,
                sticker_edit_propagation: None,
                group_id: None,
                capture_meta: None,
            }],
            links: Vec::new(),
            groups: Vec::new(),
            recycle_bin: vec![FrozenStickerEntry {
                entry_id: "entry-1".to_string(),
                source_sticker_id: "sticker-1".to_string(),
                created_at: "2026-07-25T00:00:00Z".to_string(),
                snapshot: serde_json::json!({
                    "src": retained_src,
                    "previewSrc": retained_preview,
                }),
            }],
            reference_library: Vec::new(),
            workflow_asset_archive_index: WorkflowAssetArchiveIndex::default(),
        };

        cleanup_unreferenced_session_image_assets(&root, &session_data, SystemTime::now())
            .expect("cleanup session assets");
        assert!(
            Path::new(&retained_src).exists(),
            "retained source should be kept"
        );
        assert!(
            Path::new(&retained_preview).exists(),
            "retained preview should be kept"
        );
        assert!(
            !Path::new(&stale_orphan).exists(),
            "stale orphan should be removed"
        );
        assert!(
            Path::new(&fresh_orphan).exists(),
            "fresh orphan should be retained"
        );

        let _ = std::fs::remove_dir_all(&root);
    }
