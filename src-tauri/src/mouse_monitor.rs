use std::sync::{Arc, Mutex};

#[derive(Clone, Debug, serde::Deserialize, serde::Serialize)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
    pub name: String, // Debug Label
}

impl Rect {
    pub fn contains(&self, x: f64, y: f64) -> bool {
        x >= self.x as f64
            && x <= (self.x + self.width) as f64
            && y >= self.y as f64
            && y <= (self.y + self.height) as f64
    }
}

pub fn offset_rects(rects: &[Rect], offset_x: i32, offset_y: i32) -> Vec<Rect> {
    rects
        .iter()
        .map(|rect| Rect {
            x: rect.x.saturating_add(offset_x),
            y: rect.y.saturating_add(offset_y),
            width: rect.width,
            height: rect.height,
            name: rect.name.clone(),
        })
        .collect()
}

#[allow(dead_code)]
pub fn should_ignore_cursor_events(rects: &[Rect], x: f64, y: f64) -> bool {
    !rects.iter().any(|rect| rect.contains(x, y))
}

// Thread-safe container for the list of interactive areas
#[derive(Clone)]
pub struct SharedHitMap {
    pub rectangles: Arc<Mutex<Vec<Rect>>>,
    // Flag to disable hit-testing (e.g. during Selection Mode)
    // If active = false, we effectively do nothing (or enforce a specific state)
    // Actually, for Selection Mode, we usually want full interactivity.
    // So if active = false, maybe we default to set_ignore_cursor_events(false)?
    pub active: Arc<Mutex<bool>>,
}

impl SharedHitMap {
    pub fn new() -> Self {
        Self {
            rectangles: Arc::new(Mutex::new(Vec::new())),
            active: Arc::new(Mutex::new(false)), // Default inactive
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{offset_rects, should_ignore_cursor_events, Rect};

    #[test]
    fn cursor_over_interactive_rect_disables_click_through() {
        let rects = vec![Rect {
            x: 100,
            y: 200,
            width: 300,
            height: 150,
            name: "sticker".to_string(),
        }];

        assert!(!should_ignore_cursor_events(&rects, 250.0, 260.0));
    }

    #[test]
    fn cursor_outside_interactive_rect_keeps_click_through() {
        let rects = vec![Rect {
            x: 100,
            y: 200,
            width: 300,
            height: 150,
            name: "sticker".to_string(),
        }];

        assert!(should_ignore_cursor_events(&rects, 50.0, 50.0));
    }

    #[test]
    fn local_rects_are_offset_to_positive_desktop_origin() {
        let rects = vec![Rect {
            x: 25,
            y: 40,
            width: 250,
            height: 300,
            name: "ACTIONS_MENU".to_string(),
        }];

        let global = offset_rects(&rects, 2560, 120);

        assert_eq!((global[0].x, global[0].y), (2585, 160));
        assert_eq!((global[0].width, global[0].height), (250, 300));
        assert_eq!(global[0].name, "ACTIONS_MENU");
    }

    #[test]
    fn local_rects_are_offset_to_negative_desktop_origin() {
        let rects = vec![Rect {
            x: 100,
            y: 200,
            width: 80,
            height: 60,
            name: "menu".to_string(),
        }];

        let global = offset_rects(&rects, -1920, -200);

        assert_eq!((global[0].x, global[0].y), (-1820, 0));
    }
}
