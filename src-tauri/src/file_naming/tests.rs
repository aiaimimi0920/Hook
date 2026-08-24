// Verifies rendering, shared fixtures, Windows sanitization, and atomic collision allocation.

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;
    use std::io::Write as _;

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct SharedFixture {
        render: SharedRenderCase,
        sanitize: Vec<SharedSanitizeCase>,
        invalid_patterns: Vec<String>,
    }

    #[derive(Deserialize)]
    struct SharedRenderCase {
        pattern: String,
        context: FileNamingContext,
        moment: SharedMoment,
        expected: String,
    }

    #[derive(Deserialize)]
    struct SharedMoment {
        year: i32,
        month: u32,
        day: u32,
        hour: u32,
        minute: u32,
        second: u32,
        millisecond: u32,
    }

    #[derive(Deserialize)]
    struct SharedSanitizeCase {
        input: String,
        expected: String,
    }

    fn shared_fixture() -> SharedFixture {
        serde_json::from_str(include_str!(
            "../../../__tests__/fixtures/file-naming-cases.json"
        ))
        .expect("shared file naming fixture parses")
    }

    fn fixed_moment() -> NamingMoment {
        NamingMoment {
            date: "20260802".to_string(),
            time: "14301542".to_string(),
            timestamp: "1785652215420".to_string(),
        }
    }

    #[test]
    fn renders_all_supported_placeholders() {
        let context = FileNamingContext {
            app: "Hook".to_string(),
            kind: "sticker".to_string(),
            label: "像素化".to_string(),
            title: "窗口标题".to_string(),
            process: "demo.exe".to_string(),
            unit_id: "unit-1234".to_string(),
            short_id: "1234".to_string(),
            width: Some(640),
            height: Some(480),
        };
        let rendered = render_pattern_with_moment(
            "{app}_{kind}_{label}_{title}_{process}_{unitId}_{shortId}_{width}x{height}_{date}_{time}_{timestamp}",
            &context,
            &fixed_moment(),
        );
        assert_eq!(
            rendered,
            "Hook_sticker_像素化_窗口标题_demo.exe_unit-1234_1234_640x480_20260802_14301542_1785652215420"
        );
    }

    #[test]
    fn matches_shared_typescript_fixture() {
        let fixture = shared_fixture();
        let moment = NamingMoment {
            date: format!(
                "{:04}{:02}{:02}",
                fixture.render.moment.year, fixture.render.moment.month, fixture.render.moment.day
            ),
            time: format!(
                "{:02}{:02}{:02}{:02}",
                fixture.render.moment.hour,
                fixture.render.moment.minute,
                fixture.render.moment.second,
                fixture.render.moment.millisecond / 10
            ),
            timestamp: String::new(),
        };
        assert_eq!(
            render_pattern_with_moment(&fixture.render.pattern, &fixture.render.context, &moment),
            fixture.render.expected
        );
        for case in fixture.sanitize {
            assert_eq!(sanitize_windows_filename_stem(&case.input), case.expected);
        }
        for pattern in fixture.invalid_patterns {
            assert!(validate_pattern(&pattern).is_err(), "{pattern}");
        }
    }

    #[test]
    fn validates_placeholder_syntax() {
        assert!(validate_pattern("Hook_{date}_{time}").is_ok());
        assert!(validate_pattern("Hook_{unknown}").is_err());
        assert!(validate_pattern("Hook_{date").is_err());
        assert!(validate_pattern("Hook_date}").is_err());
        assert!(validate_pattern("   ").is_err());
    }

    #[test]
    fn preserves_unicode_and_sanitizes_windows_names() {
        assert_eq!(
            sanitize_windows_filename_stem("截图_日本語:窗口?. "),
            "截图_日本語_窗口_"
        );
        assert_eq!(sanitize_windows_filename_stem("CON"), "_CON");
        assert_eq!(
            sanitize_windows_filename_stem("com9.report"),
            "_com9.report"
        );
        assert_eq!(sanitize_windows_filename_stem(".."), "Hook");
        assert!(!sanitize_windows_filename_stem("a\\..\\b").contains(['/', '\\']));
    }

    #[test]
    fn truncates_stems_by_unicode_scalar_count() {
        let value = "图".repeat(MAX_FILENAME_STEM_CHARS + 20);
        let sanitized = sanitize_windows_filename_stem(&value);
        assert_eq!(sanitized.chars().count(), MAX_FILENAME_STEM_CHARS);
    }

    #[test]
    fn atomically_allocates_incrementing_collisions() {
        let root = std::env::temp_dir().join(format!(
            "hook-file-naming-test-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        std::fs::create_dir_all(&root).expect("create test dir");

        let (mut first, first_path) = create_unique_file(&root, "测试", Some("png")).unwrap();
        first.write_all(b"one").unwrap();
        let (mut second, second_path) = create_unique_file(&root, "测试", Some("png")).unwrap();
        second.write_all(b"two").unwrap();

        assert_eq!(first_path.file_name().unwrap(), "测试.png");
        assert_eq!(second_path.file_name().unwrap(), "测试_2.png");
        assert_eq!(std::fs::read(&first_path).unwrap(), b"one");
        assert_eq!(std::fs::read(&second_path).unwrap(), b"two");
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn collision_suffix_keeps_final_stem_within_limit() {
        let root = std::env::temp_dir().join(format!(
            "hook-file-naming-long-collision-test-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let stem = "图".repeat(MAX_FILENAME_STEM_CHARS);
        let (first, _) = create_unique_file(&root, &stem, Some("png")).unwrap();
        drop(first);
        let (second, second_path) = create_unique_file(&root, &stem, Some("png")).unwrap();
        drop(second);
        assert_eq!(
            second_path
                .file_stem()
                .unwrap()
                .to_string_lossy()
                .chars()
                .count(),
            MAX_FILENAME_STEM_CHARS
        );
        assert!(second_path
            .file_stem()
            .unwrap()
            .to_string_lossy()
            .ends_with("_2"));
        let _ = std::fs::remove_dir_all(root);
    }
}
