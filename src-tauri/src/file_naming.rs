use serde::{Deserialize, Serialize};
use std::fs::{File, OpenOptions};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

pub const FILE_NAMING_SCHEMA_VERSION: u32 = 1;
pub const MAX_FILENAME_STEM_CHARS: usize = 120;
pub const SUPPORTED_PLACEHOLDERS: &[&str] = &[
    "app",
    "kind",
    "label",
    "title",
    "process",
    "unitId",
    "shortId",
    "width",
    "height",
    "date",
    "time",
    "timestamp",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CollisionPolicy {
    Increment,
}

impl Default for CollisionPolicy {
    fn default() -> Self {
        Self::Increment
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FileNamingSettings {
    pub sticker_save_pattern: String,
    pub drag_export_pattern: String,
    pub clipboard_file_pattern: String,
    pub title_max_length: usize,
    pub collision_policy: CollisionPolicy,
}

impl Default for FileNamingSettings {
    fn default() -> Self {
        Self {
            sticker_save_pattern: "Hook_{date}_{time}_{width}x{height}".to_string(),
            drag_export_pattern: "{label}_{shortId}_{date}_{time}".to_string(),
            clipboard_file_pattern: "Hook_{kind}_{date}_{time}".to_string(),
            title_max_length: 80,
            collision_policy: CollisionPolicy::Increment,
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FileNamingContext {
    pub app: String,
    pub kind: String,
    pub label: String,
    pub title: String,
    pub process: String,
    pub unit_id: String,
    pub short_id: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
}

impl FileNamingContext {
    pub fn with_dimensions(mut self, width: u32, height: u32) -> Self {
        self.width = Some(width);
        self.height = Some(height);
        self
    }

    fn normalized(mut self, title_max_length: usize) -> Self {
        if self.app.trim().is_empty() {
            self.app = "Hook".to_string();
        }
        if self.kind.trim().is_empty() {
            self.kind = "image".to_string();
        }
        if self.label.trim().is_empty() {
            self.label = self.kind.clone();
        }
        if self.short_id.trim().is_empty() && !self.unit_id.trim().is_empty() {
            self.short_id = self
                .unit_id
                .chars()
                .rev()
                .take(4)
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
                .collect();
        }
        self.title = self.title.chars().take(title_max_length).collect();
        self
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FileNamingPatternKind {
    StickerSave,
    DragExport,
    ClipboardFile,
}

impl FileNamingPatternKind {
    fn pattern<'a>(&self, settings: &'a FileNamingSettings) -> &'a str {
        match self {
            Self::StickerSave => &settings.sticker_save_pattern,
            Self::DragExport => &settings.drag_export_pattern,
            Self::ClipboardFile => &settings.clipboard_file_pattern,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct NamingMoment {
    date: String,
    time: String,
    timestamp: String,
}

impl NamingMoment {
    fn now() -> Self {
        current_naming_moment()
    }
}

#[cfg(target_os = "windows")]
fn current_naming_moment() -> NamingMoment {
    use windows_sys::Win32::Foundation::SYSTEMTIME;
    use windows_sys::Win32::System::SystemInformation::GetLocalTime;

    let mut local: SYSTEMTIME = unsafe { std::mem::zeroed() };
    unsafe { GetLocalTime(&mut local) };
    NamingMoment {
        date: format!("{:04}{:02}{:02}", local.wYear, local.wMonth, local.wDay),
        time: format!(
            "{:02}{:02}{:02}{:02}",
            local.wHour,
            local.wMinute,
            local.wSecond,
            local.wMilliseconds / 10
        ),
        timestamp: unix_timestamp_millis().to_string(),
    }
}

#[cfg(not(target_os = "windows"))]
fn current_naming_moment() -> NamingMoment {
    let timestamp_millis = unix_timestamp_millis();
    let total_seconds = (timestamp_millis / 1_000) as i64;
    let days = total_seconds.div_euclid(86_400);
    let seconds_of_day = total_seconds.rem_euclid(86_400);
    let (year, month, day) = civil_date_from_unix_days(days);
    NamingMoment {
        date: format!("{year:04}{month:02}{day:02}"),
        time: format!(
            "{:02}{:02}{:02}{:02}",
            seconds_of_day / 3_600,
            (seconds_of_day % 3_600) / 60,
            seconds_of_day % 60,
            (timestamp_millis % 1_000) / 10
        ),
        timestamp: timestamp_millis.to_string(),
    }
}

fn unix_timestamp_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

#[cfg(not(target_os = "windows"))]
fn civil_date_from_unix_days(days_since_epoch: i64) -> (i64, i64, i64) {
    let z = days_since_epoch + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let day_of_era = z - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let mut year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_prime = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_prime + 2) / 5 + 1;
    let month = month_prime + if month_prime < 10 { 3 } else { -9 };
    year += i64::from(month <= 2);
    (year, month, day)
}

pub fn normalize_file_naming_settings(mut settings: FileNamingSettings) -> FileNamingSettings {
    let defaults = FileNamingSettings::default();
    settings.title_max_length = settings.title_max_length.clamp(1, 240);
    if validate_pattern(&settings.sticker_save_pattern).is_err() {
        settings.sticker_save_pattern = defaults.sticker_save_pattern;
    }
    if validate_pattern(&settings.drag_export_pattern).is_err() {
        settings.drag_export_pattern = defaults.drag_export_pattern;
    }
    if validate_pattern(&settings.clipboard_file_pattern).is_err() {
        settings.clipboard_file_pattern = defaults.clipboard_file_pattern;
    }
    settings
}

pub fn validate_file_naming_settings(settings: &FileNamingSettings) -> Result<(), String> {
    validate_pattern(&settings.sticker_save_pattern)
        .map_err(|error| format!("Invalid stickerSavePattern: {error}"))?;
    validate_pattern(&settings.drag_export_pattern)
        .map_err(|error| format!("Invalid dragExportPattern: {error}"))?;
    validate_pattern(&settings.clipboard_file_pattern)
        .map_err(|error| format!("Invalid clipboardFilePattern: {error}"))?;
    if !(1..=240).contains(&settings.title_max_length) {
        return Err("titleMaxLength must be between 1 and 240".to_string());
    }
    Ok(())
}

pub fn validate_pattern(pattern: &str) -> Result<(), String> {
    if pattern.trim().is_empty() {
        return Err("pattern cannot be empty".to_string());
    }

    let chars: Vec<char> = pattern.chars().collect();
    let mut index = 0;
    while index < chars.len() {
        match chars[index] {
            '{' => {
                let Some(relative_end) = chars[index + 1..].iter().position(|ch| *ch == '}') else {
                    return Err("unclosed placeholder".to_string());
                };
                let end = index + 1 + relative_end;
                let name: String = chars[index + 1..end].iter().collect();
                if name.is_empty() {
                    return Err("placeholder cannot be empty".to_string());
                }
                if !SUPPORTED_PLACEHOLDERS.contains(&name.as_str()) {
                    return Err(format!("unsupported placeholder {{{name}}}"));
                }
                index = end + 1;
            }
            '}' => return Err("unmatched closing brace".to_string()),
            _ => index += 1,
        }
    }
    Ok(())
}

pub fn render_file_stem(
    settings: &FileNamingSettings,
    kind: FileNamingPatternKind,
    context: FileNamingContext,
) -> String {
    let settings = normalize_file_naming_settings(settings.clone());
    let context = context.normalized(settings.title_max_length);
    let rendered =
        render_pattern_with_moment(kind.pattern(&settings), &context, &NamingMoment::now());
    sanitize_windows_filename_stem(&rendered)
}

fn render_pattern_with_moment(
    pattern: &str,
    context: &FileNamingContext,
    moment: &NamingMoment,
) -> String {
    let mut output = String::with_capacity(pattern.len() + 32);
    let chars: Vec<char> = pattern.chars().collect();
    let mut index = 0;
    while index < chars.len() {
        if chars[index] != '{' {
            output.push(chars[index]);
            index += 1;
            continue;
        }

        let end = chars[index + 1..]
            .iter()
            .position(|ch| *ch == '}')
            .map(|relative| index + 1 + relative)
            .unwrap_or(chars.len());
        if end >= chars.len() {
            output.extend(chars[index..].iter());
            break;
        }
        let name: String = chars[index + 1..end].iter().collect();
        let value = match name.as_str() {
            "app" => context.app.clone(),
            "kind" => context.kind.clone(),
            "label" => context.label.clone(),
            "title" => context.title.clone(),
            "process" => context.process.clone(),
            "unitId" => context.unit_id.clone(),
            "shortId" => context.short_id.clone(),
            "width" => context
                .width
                .map(|value| value.to_string())
                .unwrap_or_default(),
            "height" => context
                .height
                .map(|value| value.to_string())
                .unwrap_or_default(),
            "date" => moment.date.clone(),
            "time" => moment.time.clone(),
            "timestamp" => moment.timestamp.clone(),
            _ => String::new(),
        };
        output.push_str(&value);
        index = end + 1;
    }
    output
}

pub fn sanitize_windows_filename_stem(value: &str) -> String {
    let mut sanitized = String::with_capacity(value.len());
    let mut previous_replacement = false;
    for ch in value.chars() {
        let invalid =
            ch.is_control() || matches!(ch, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|');
        if invalid {
            if !previous_replacement {
                sanitized.push('_');
                previous_replacement = true;
            }
        } else {
            sanitized.push(ch);
            previous_replacement = false;
        }
    }

    let mut sanitized: String = sanitized.chars().take(MAX_FILENAME_STEM_CHARS).collect();
    while sanitized.ends_with([' ', '.']) {
        sanitized.pop();
    }
    if sanitized.is_empty() || sanitized == "." || sanitized == ".." {
        sanitized = "Hook".to_string();
    }
    if is_reserved_windows_device_name(&sanitized) {
        sanitized.insert(0, '_');
        sanitized = sanitized.chars().take(MAX_FILENAME_STEM_CHARS).collect();
    }
    sanitized
}

fn is_reserved_windows_device_name(value: &str) -> bool {
    let base = value
        .trim_end_matches([' ', '.'])
        .split('.')
        .next()
        .unwrap_or_default()
        .to_ascii_uppercase();
    matches!(base.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || base
            .strip_prefix("COM")
            .and_then(|suffix| suffix.parse::<u8>().ok())
            .is_some_and(|number| (1..=9).contains(&number))
        || base
            .strip_prefix("LPT")
            .and_then(|suffix| suffix.parse::<u8>().ok())
            .is_some_and(|number| (1..=9).contains(&number))
}

pub fn sanitize_extension(extension: Option<&str>) -> String {
    let sanitized = extension
        .unwrap_or("png")
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric())
        .take(8)
        .collect::<String>()
        .to_ascii_lowercase();
    if sanitized.is_empty() {
        "png".to_string()
    } else {
        sanitized
    }
}

pub fn create_unique_file(
    target_dir: &Path,
    stem: &str,
    extension: Option<&str>,
) -> Result<(File, PathBuf), String> {
    let stem = sanitize_windows_filename_stem(stem);
    let extension = sanitize_extension(extension);
    for index in 1..10_000u32 {
        let suffix = if index == 1 {
            String::new()
        } else {
            format!("_{index}")
        };
        let base_limit = MAX_FILENAME_STEM_CHARS.saturating_sub(suffix.chars().count());
        let bounded_stem: String = stem.chars().take(base_limit).collect();
        let filename = format!("{bounded_stem}{suffix}.{extension}");
        let path = target_dir.join(filename);
        match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(file) => return Ok((file, path)),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => {
                return Err(format!(
                    "Failed to atomically allocate output file {}: {}",
                    path.to_string_lossy(),
                    error
                ))
            }
        }
    }
    Err(format!(
        "Failed to allocate a unique filename for {stem}.{extension}"
    ))
}

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
            "../../__tests__/fixtures/file-naming-cases.json"
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
