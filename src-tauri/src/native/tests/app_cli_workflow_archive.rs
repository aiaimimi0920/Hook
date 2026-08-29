// Verifies workflow archive references, cleanup retention, and snapshot replacement.

    #[test]
    fn session_asset_cleanup_keeps_assets_referenced_only_by_workflow_archive_index() {
        let root = std::env::temp_dir().join(format!(
            "hook-session-asset-archive-cleanup-test-{}-{}",
            std::process::id(),
            file_timestamp_component()
        ));
        std::fs::create_dir_all(&root).expect("create session asset archive cleanup test dir");
        let archived_preview = persist_session_image_asset(
            &root,
            "sticker-9",
            "preview",
            &tiny_png_data_url_for_test([90, 100, 110]),
        )
        .expect("persist archived preview");
        let stale_orphan = persist_session_image_asset(
            &root,
            "sticker-10",
            "preview",
            &tiny_png_data_url_for_test([120, 130, 140]),
        )
        .expect("persist stale orphan");

        let old_time = SystemTime::now()
            - std::time::Duration::from_secs(SESSION_IMAGE_ASSET_RETENTION_SECS + 60);
        set_file_modified_time_for_test(Path::new(&archived_preview), old_time)
            .expect("age archived preview");
        set_file_modified_time_for_test(Path::new(&stale_orphan), old_time)
            .expect("age stale orphan");

        let session_data = SessionData {
            document_schema_version: SESSION_DOCUMENT_SCHEMA_VERSION,
            document_revision: 0,
            stickers: Vec::new(),
            links: Vec::new(),
            groups: Vec::new(),
            recycle_bin: Vec::new(),
            reference_library: Vec::new(),
            workflow_asset_archive_index: WorkflowAssetArchiveIndex {
                version: 1,
                workflows: std::collections::BTreeMap::from([(
                    "wf-1".to_string(),
                    WorkflowAssetArchiveWorkflowIndex {
                        updated_at: "123".to_string(),
                        nodes: std::collections::BTreeMap::from([(
                            "node-1".to_string(),
                            WorkflowAssetArchiveNodeIndex {
                                sticker_id: "sticker-9".to_string(),
                                updated_at: "123".to_string(),
                                src: None,
                                preview_src: Some(archived_preview.clone()),
                            },
                        )]),
                    },
                )]),
            },
        };

        cleanup_unreferenced_session_image_assets(&root, &session_data, SystemTime::now())
            .expect("cleanup session assets");

        assert!(
            Path::new(&archived_preview).exists(),
            "workflow archive reference should keep asset alive"
        );
        assert!(
            !Path::new(&stale_orphan).exists(),
            "stale orphan should be removed"
        );

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn workflow_asset_archive_merge_replaces_prior_workflow_snapshot_instead_of_appending() {
        let existing = WorkflowAssetArchiveIndex {
            version: 1,
            workflows: std::collections::BTreeMap::from([
                (
                    "wf-1".to_string(),
                    WorkflowAssetArchiveWorkflowIndex {
                        updated_at: "old-1".to_string(),
                        nodes: std::collections::BTreeMap::from([(
                            "old-node".to_string(),
                            WorkflowAssetArchiveNodeIndex {
                                sticker_id: "sticker-old".to_string(),
                                updated_at: "old-1".to_string(),
                                src: Some("C:\\archive\\old-source.png".to_string()),
                                preview_src: Some("C:\\archive\\old-preview.png".to_string()),
                            },
                        )]),
                    },
                ),
                (
                    "wf-2".to_string(),
                    WorkflowAssetArchiveWorkflowIndex {
                        updated_at: "keep-1".to_string(),
                        nodes: std::collections::BTreeMap::from([(
                            "keep-node".to_string(),
                            WorkflowAssetArchiveNodeIndex {
                                sticker_id: "sticker-keep".to_string(),
                                updated_at: "keep-1".to_string(),
                                src: Some("C:\\archive\\keep-source.png".to_string()),
                                preview_src: Some("C:\\archive\\keep-preview.png".to_string()),
                            },
                        )]),
                    },
                ),
            ]),
        };
        let hints = WorkflowAssetArchiveHints {
            workflows: std::collections::BTreeMap::from([(
                "wf-1".to_string(),
                WorkflowAssetArchiveWorkflowHint {
                    nodes: std::collections::BTreeMap::from([(
                        "new-node".to_string(),
                        WorkflowAssetArchiveNodeHint {
                            sticker_id: "sticker-new".to_string(),
                        },
                    )]),
                },
            )]),
        };
        let processed_stickers = vec![StickerData {
            id: "sticker-new".to_string(),
            src: "C:\\archive\\new-source.png".to_string(),
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
            preview_src: Some("C:\\archive\\new-preview.png".to_string()),
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

        let merged = merge_workflow_asset_archive_index(&existing, &hints, &processed_stickers);

        let merged_wf_1 = merged
            .workflows
            .get("wf-1")
            .expect("updated workflow should be present");
        assert_eq!(
            merged_wf_1.nodes.len(),
            1,
            "resynced workflow should replace its archived node set instead of appending"
        );
        assert!(
            !merged_wf_1.nodes.contains_key("old-node"),
            "superseded archived nodes must be dropped so their baked assets can age out"
        );
        let new_node = merged_wf_1
            .nodes
            .get("new-node")
            .expect("new archived node should be present");
        assert_eq!(new_node.sticker_id, "sticker-new");
        assert_eq!(new_node.src.as_deref(), Some("C:\\archive\\new-source.png"));
        assert_eq!(
            new_node.preview_src.as_deref(),
            Some("C:\\archive\\new-preview.png")
        );

        let untouched_wf_2 = merged
            .workflows
            .get("wf-2")
            .expect("unrelated workflow should be preserved");
        assert!(
            untouched_wf_2.nodes.contains_key("keep-node"),
            "workflows that were not part of this sync must keep their prior archive index"
        );
    }
