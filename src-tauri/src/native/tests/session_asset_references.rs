// Exercise the same save worker used by Tauri without constructing a native window.
fn session_asset_request(
    sticker: StickerData,
    revision: u64,
    paths: Vec<String>,
) -> SessionSaveRequest {
    SessionSaveRequest {
        stickers: vec![sticker],
        links: Vec::new(),
        groups: None,
        recycle_bin: None,
        reference_library: None,
        workflow_asset_archive_hints: None,
        expected_document_revision: Some(revision),
        managed_asset_paths: Some(paths),
    }
}

#[test]
fn session_save_reuses_committed_assets_and_recovers_missing_references() {
    let root = std::env::temp_dir().join(format!("hook-session-assets-{}", uuid::Uuid::new_v4()));
    let original: StickerData = serde_json::from_value(serde_json::json!({
        "id": "one", "src": tiny_png_data_url_for_test([1, 2, 3]),
        "previewSrc": tiny_png_data_url_for_test([4, 5, 6]), "x": 0, "y": 0, "w": 1, "h": 1
    }))
    .unwrap();
    let first = save_session_to_dir(
        root.clone(),
        session_asset_request(original.clone(), 0, Vec::new()),
    )
    .unwrap();
    assert_eq!(first.document_revision, 1);
    assert_eq!(first.image_assets.len(), 1);
    let assets = &first.image_assets[0];
    let source = assets.src.clone().unwrap();
    let preview = assets.preview_src.clone().unwrap();
    let source_modified = fs::metadata(&source).unwrap().modified().unwrap();
    let mut moved = original.clone();
    moved.x = 200.0;
    moved.src = source.clone();
    moved.preview_src = Some(preview.clone());
    let second = save_session_to_dir(
        root.clone(),
        session_asset_request(moved.clone(), 1, vec![source.clone(), preview.clone()]),
    )
    .unwrap();
    assert_eq!(second.document_revision, 2);
    assert!(second.image_assets.is_empty());
    assert_eq!(
        fs::metadata(&source).unwrap().modified().unwrap(),
        source_modified
    );
    assert_eq!(load_session_from_dir(&root).unwrap().stickers[0].x, 200.0);
    let committed = fs::read(root.join("session.json")).unwrap();
    fs::remove_file(&preview).unwrap();
    let error = save_session_to_dir(root.clone(), session_asset_request(moved, 2, vec![preview]))
        .unwrap_err();
    assert!(error.contains("SESSION_ASSET_MISSING"));
    assert_eq!(fs::read(root.join("session.json")).unwrap(), committed);
    let mut recovered = original.clone();
    recovered.x = 200.0;
    let third = save_session_to_dir(
        root.clone(),
        session_asset_request(recovered, 2, Vec::new()),
    )
    .unwrap();
    assert_eq!(third.document_revision, 3);
    assert!(Path::new(third.image_assets[0].preview_src.as_ref().unwrap()).is_file());
    let committed = fs::read(root.join("session.json")).unwrap();
    let stale = save_session_to_dir(root.clone(), session_asset_request(original, 2, Vec::new()))
        .unwrap_err();
    assert!(stale.contains("SESSION_REVISION_CONFLICT"));
    assert_eq!(fs::read(root.join("session.json")).unwrap(), committed);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn image_decode_retains_validated_pixels_and_rejects_invalid_content() {
    let encoded = tiny_png_data_url_for_test([17, 31, 93]);
    let (bytes, pixels) = decode_base64_image_with_pixels(&encoded).unwrap();
    assert_eq!((pixels.width(), pixels.height()), (1, 1));
    assert_eq!(pixels.to_rgb8().get_pixel(0, 0).0, [17, 31, 93]);
    assert_eq!(image_dimensions_from_bytes(&bytes).unwrap(), (1, 1));
    assert_eq!(decode_base64_image_data(&encoded).unwrap(), bytes);
    assert!(decode_base64_image_with_pixels("data:image/png;base64,bm90IGFuIGltYWdl").is_err());
}
