// Reads exact provider values and source-window-relative control anchors from UIA elements.
#[cfg(target_os = "windows")]
fn sample_live_uia_element(
    element: &uiautomation::UIElement,
    ancestor_path: Vec<String>,
    root_rect: uiautomation::types::Rect,
    capabilities: &mut std::collections::BTreeSet<String>,
) -> Option<UiaObservationSample> {
    use uiautomation::patterns::{
        UIInvokePattern, UIRangeValuePattern, UIScrollPattern, UITogglePattern, UIValuePattern,
    };
    use uiautomation::types::{ControlType, ToggleState};

    let control_type = element.get_control_type().ok()?;
    let control_type_name = match control_type {
        ControlType::ProgressBar => "ProgressBar",
        ControlType::Button => "Button",
        ControlType::Text => "Text",
        ControlType::CheckBox => "CheckBox",
        ControlType::Slider => "Slider",
        ControlType::Window => "Window",
        _ => return None,
    };
    let automation_id = element
        .get_automation_id()
        .ok()
        .and_then(|value| bounded_live_observation_text(value, 512));
    let name = element
        .get_name()
        .ok()
        .and_then(|value| bounded_live_observation_text(value, 512));
    if automation_id.is_none() && name.is_none() {
        return None;
    }
    let rect = element.get_bounding_rectangle().ok()?;
    if !live_uia_rect_intersects(rect, root_rect) {
        return None;
    }
    let locator = LiveRelayElementLocator {
        automation_id,
        name,
        control_type: control_type_name.to_owned(),
        ancestor_path,
        runtime_id: element
            .get_runtime_id()
            .ok()
            .filter(|value| value.len() <= 64),
    };
    let observation_id = live_uia_observation_id(&locator)?;
    let mut value = serde_json::Map::new();
    value.insert("anchor".to_owned(), live_uia_anchor_value(rect, root_rect));
    let enabled = element.is_enabled().map_err(|_| "uia_enabled_unreadable");
    let offscreen = element
        .is_offscreen()
        .map_err(|_| "uia_offscreen_unreadable");
    let focused = element
        .has_keyboard_focus()
        .map_err(|_| "uia_focus_unreadable");
    let mut read_error = enabled
        .as_ref()
        .err()
        .or(offscreen.as_ref().err())
        .or(focused.as_ref().err())
        .copied();
    if let Ok(enabled) = enabled {
        value.insert("enabled".to_owned(), serde_json::json!(enabled));
    }
    if let Ok(offscreen) = offscreen {
        value.insert("offscreen".to_owned(), serde_json::json!(offscreen));
    }
    if let Ok(focused) = focused {
        value.insert("focused".to_owned(), serde_json::json!(focused));
    }
    let mut patterns = Vec::new();
    if element.get_pattern::<UIInvokePattern>().is_ok() {
        capabilities.insert("invoke".to_owned());
        patterns.push("invoke");
    }
    if let Ok(pattern) = element.get_pattern::<UIRangeValuePattern>() {
        capabilities.insert("range_value".to_owned());
        patterns.push("range_value");
        match (
            pattern.get_value(),
            pattern.get_minimum(),
            pattern.get_maximum(),
            pattern.is_readonly(),
        ) {
            (Ok(current), Ok(minimum), Ok(maximum), Ok(read_only)) => {
                value.insert(
                    "rangeValue".to_owned(),
                    serde_json::json!({
                        "value": current,
                        "minimum": minimum,
                        "maximum": maximum,
                        "readOnly": read_only,
                    }),
                );
            }
            _ => read_error = Some("uia_range_value_unreadable"),
        }
    }
    if let Ok(pattern) = element.get_pattern::<UIValuePattern>() {
        capabilities.insert("value".to_owned());
        patterns.push("value");
        match (pattern.get_value(), pattern.is_readonly()) {
            (Ok(text), Ok(read_only)) => {
                value.insert(
                    "value".to_owned(),
                    serde_json::json!({
                        "text": text.chars().take(4096).collect::<String>(),
                        "readOnly": read_only,
                    }),
                );
            }
            _ => read_error = Some("uia_value_unreadable"),
        }
    }
    if let Ok(pattern) = element.get_pattern::<UITogglePattern>() {
        capabilities.insert("toggle".to_owned());
        patterns.push("toggle");
        match pattern.get_toggle_state() {
            Ok(state) => {
                let state = match state {
                    ToggleState::Off => "off",
                    ToggleState::On => "on",
                    ToggleState::Indeterminate => "indeterminate",
                };
                value.insert("toggleState".to_owned(), serde_json::json!(state));
            }
            Err(_) => read_error = Some("uia_toggle_unreadable"),
        }
    }
    if let Ok(pattern) = element.get_pattern::<UIScrollPattern>() {
        capabilities.insert("scroll".to_owned());
        patterns.push("scroll");
        match (
            pattern.get_horizontal_scroll_percent(),
            pattern.get_vertical_scroll_percent(),
        ) {
            (Ok(horizontal), Ok(vertical)) => {
                value.insert(
                    "scroll".to_owned(),
                    serde_json::json!({
                        "horizontalPercent": horizontal,
                        "verticalPercent": vertical,
                    }),
                );
            }
            _ => read_error = Some("uia_scroll_unreadable"),
        }
    }
    if control_type == ControlType::Text {
        value.insert(
            "text".to_owned(),
            serde_json::json!(locator.name.as_deref()),
        );
    } else if control_type == ControlType::Window {
        value.insert(
            "title".to_owned(),
            serde_json::json!(locator.name.as_deref()),
        );
    }
    value.insert("patterns".to_owned(), serde_json::json!(patterns));
    let value = read_error
        .map(|reason| Err(reason.to_owned()))
        .unwrap_or_else(|| Ok(serde_json::Value::Object(value)));
    let fingerprint = value
        .as_ref()
        .ok()
        .and_then(|value| serde_json::to_string(value).ok());
    Some(UiaObservationSample {
        observation_id,
        locator,
        value,
        fingerprint,
    })
}

#[cfg(target_os = "windows")]
fn live_uia_ancestor_label(element: &uiautomation::UIElement) -> Option<String> {
    let control_type = element
        .get_control_type()
        .map(|value| format!("{value:?}"))
        .unwrap_or_else(|_| "Unknown".to_owned());
    let identity = element
        .get_automation_id()
        .ok()
        .and_then(|value| bounded_live_observation_text(value, 400));
    Some(identity.map_or(control_type.clone(), |value| {
        format!("{control_type}:{value}")
    }))
}

#[cfg(target_os = "windows")]
fn live_uia_observation_id(locator: &LiveRelayElementLocator) -> Option<String> {
    use sha2::Digest as _;

    let stable_name = locator.automation_id.is_none().then_some(&locator.name);
    let stable = serde_json::to_vec(&serde_json::json!({
        "automationId": &locator.automation_id,
        "name": stable_name,
        "controlType": &locator.control_type,
        "ancestorPath": &locator.ancestor_path,
    }))
    .ok()?;
    let digest = sha2::Sha256::digest(stable);
    Some(format!("uia:{}", &format!("{digest:x}")[..24]))
}

#[cfg(all(test, target_os = "windows"))]
mod live_observation_uia_sample_tests {
    use super::*;

    #[test]
    fn automation_id_keeps_observation_id_stable_when_name_changes() {
        let locator = |name: &str| LiveRelayElementLocator {
            automation_id: Some("animationLabel".to_owned()),
            name: Some(name.to_owned()),
            control_type: "Text".to_owned(),
            ancestor_path: vec!["Window:liveScreenshotFixture".to_owned()],
            runtime_id: None,
        };

        assert_eq!(
            live_uia_observation_id(&locator("Frame 1")),
            live_uia_observation_id(&locator("Frame 2"))
        );
    }
}

#[cfg(target_os = "windows")]
fn live_uia_rect_intersects(
    value: uiautomation::types::Rect,
    root: uiautomation::types::Rect,
) -> bool {
    value.get_right() >= root.get_left()
        && value.get_left() <= root.get_right()
        && value.get_bottom() >= root.get_top()
        && value.get_top() <= root.get_bottom()
        && value.get_width() > 0
        && value.get_height() > 0
}

#[cfg(target_os = "windows")]
fn live_uia_anchor_value(
    value: uiautomation::types::Rect,
    root: uiautomation::types::Rect,
) -> serde_json::Value {
    let width = root.get_width().max(1) as f64;
    let height = root.get_height().max(1) as f64;
    serde_json::json!({
        "coordinateSpace": "source_window",
        "screenBounds": {
            "x": value.get_left(),
            "y": value.get_top(),
            "width": value.get_width().max(1),
            "height": value.get_height().max(1),
        },
        "normalizedBounds": {
            "x": ((value.get_left() - root.get_left()) as f64 / width).clamp(0.0, 1.0),
            "y": ((value.get_top() - root.get_top()) as f64 / height).clamp(0.0, 1.0),
            "width": (value.get_width().max(1) as f64 / width).clamp(0.0, 1.0),
            "height": (value.get_height().max(1) as f64 / height).clamp(0.0, 1.0),
        }
    })
}
