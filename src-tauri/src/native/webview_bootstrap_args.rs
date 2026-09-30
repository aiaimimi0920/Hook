// Keep the cursor policy in one effective Chromium feature switch.
pub(super) fn with_visible_typing_cursor(arguments: &str) -> String {
    let mut features = std::collections::BTreeSet::from(["HideCursorWhileTyping"]);
    let mut retained = Vec::new();
    for argument in argument_spans(arguments) {
        let normalized = argument.trim_matches('"');
        if let Some(value) = normalized.strip_prefix("--disable-features=") {
            features.extend(
                value
                    .trim_matches('"')
                    .split(',')
                    .map(str::trim)
                    .filter(|feature| !feature.is_empty()),
            );
        } else {
            retained.push(argument);
        }
    }
    let mut combined = retained.join(" ");
    if !combined.is_empty() {
        combined.push(' ');
    }
    combined.push_str("--disable-features=");
    combined.push_str(&features.into_iter().collect::<Vec<_>>().join(","));
    combined
}

fn argument_spans(arguments: &str) -> Vec<&str> {
    let mut spans = Vec::new();
    let mut start = None;
    let mut quoted = false;
    let mut backslashes = 0;
    for (index, character) in arguments.char_indices() {
        if character.is_whitespace() && !quoted {
            if let Some(start) = start.take() {
                spans.push(&arguments[start..index]);
            }
        } else {
            start.get_or_insert(index);
        }
        if character == '"' && backslashes % 2 == 0 {
            quoted = !quoted;
        }
        backslashes = if character == '\\' {
            backslashes + 1
        } else {
            0
        };
    }
    if let Some(start) = start {
        spans.push(&arguments[start..]);
    }
    spans
}

#[cfg(test)]
mod tests {
    use super::with_visible_typing_cursor;

    #[test]
    fn merges_duplicate_feature_switches_without_losing_quoted_arguments() {
        let arguments = r#"--user-agent="Hook  Custom Agent" --disable-features=Existing --remote-debugging-port=9337 --disable-features="UseSkiaRenderer,CanvasOopRasterization""#;
        let result = with_visible_typing_cursor(arguments);
        assert_eq!(result.matches("--disable-features=").count(), 1);
        assert!(result.contains(r#"--user-agent="Hook  Custom Agent""#));
        assert!(result.contains("--remote-debugging-port=9337"));
        assert!(result.ends_with("--disable-features=CanvasOopRasterization,Existing,HideCursorWhileTyping,UseSkiaRenderer"));
        assert_eq!(with_visible_typing_cursor(&result), result);
    }

    #[test]
    fn does_not_treat_a_feature_name_inside_another_quoted_value_as_a_switch() {
        let result =
            with_visible_typing_cursor(r#"--user-agent="test --disable-features=Unrelated""#);
        assert!(result.ends_with("--disable-features=HideCursorWhileTyping"));
        assert!(result.starts_with(r#"--user-agent="test --disable-features=Unrelated""#));
        assert_eq!(
            with_visible_typing_cursor(""),
            "--disable-features=HideCursorWhileTyping"
        );
    }
}
