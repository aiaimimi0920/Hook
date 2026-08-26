use crate::capture_coords::CaptureWindowMetrics;
use crate::capture_windows::CaptureWindowTarget;

#[derive(Clone, Debug)]
pub(crate) struct ResolvedProtectedWindow {
    pub(crate) id: String,
    pub(crate) occluding_windows: Vec<CaptureWindowTarget>,
}

fn rectangles_overlap(
    left: f64,
    top: f64,
    right: f64,
    bottom: f64,
    target: &CaptureWindowTarget,
) -> bool {
    target.x < right && target.x + target.w > left && target.y < bottom && target.y + target.h > top
}

pub(crate) fn resolve_protected_window_from_targets<F>(
    targets: &[CaptureWindowTarget],
    selection_left: f64,
    selection_top: f64,
    selection_right: f64,
    selection_bottom: f64,
    mut is_protected: F,
) -> Option<ResolvedProtectedWindow>
where
    F: FnMut(&CaptureWindowTarget) -> bool,
{
    let protected = targets
        .iter()
        .filter(|target| {
            rectangles_overlap(
                selection_left,
                selection_top,
                selection_right,
                selection_bottom,
                target,
            ) && is_protected(target)
        })
        .min_by_key(|target| target.z_order)?;
    let occluding_windows = targets
        .iter()
        .filter(|target| {
            target.z_order < protected.z_order
                && rectangles_overlap(
                    protected.x,
                    protected.y,
                    protected.x + protected.w,
                    protected.y + protected.h,
                    target,
                )
        })
        .cloned()
        .collect();
    Some(ResolvedProtectedWindow {
        id: protected.id.clone(),
        occluding_windows,
    })
}

#[cfg(target_os = "windows")]
pub(crate) fn overlapping_protected_window(
    x: i32,
    y: i32,
    w: u32,
    h: u32,
    display_metrics: CaptureWindowMetrics,
) -> Option<ResolvedProtectedWindow> {
    let selection_left = x as f64;
    let selection_top = y as f64;
    let selection_right = selection_left + w as f64;
    let selection_bottom = selection_top + h as f64;
    let targets = crate::capture_windows::list_capture_window_targets(display_metrics);
    resolve_protected_window_from_targets(
        &targets,
        selection_left,
        selection_top,
        selection_right,
        selection_bottom,
        |target| {
            crate::screenshot::window_display_affinity(&target.id)
                .is_some_and(|affinity| affinity != 0)
        },
    )
}

#[cfg(test)]
mod tests {
    use super::resolve_protected_window_from_targets;
    use crate::capture_windows::CaptureWindowTarget;

    #[test]
    fn resolves_protected_target_and_only_windows_above_it_as_occluders() {
        let target =
            |id: &str, x: f64, y: f64, w: f64, h: f64, z_order: usize| CaptureWindowTarget {
                id: id.to_string(),
                x,
                y,
                w,
                h,
                title: None,
                process_id: 1,
                z_order,
            };
        let targets = vec![
            target("occluder", 2.0, 2.0, 4.0, 4.0, 2),
            target("protected", 0.0, 0.0, 10.0, 10.0, 5),
            target("behind", 1.0, 1.0, 8.0, 8.0, 9),
            target("side-by-side", 12.0, 0.0, 4.0, 4.0, 1),
        ];

        let resolved =
            resolve_protected_window_from_targets(&targets, 0.0, 0.0, 8.0, 8.0, |target| {
                target.id == "protected"
            })
            .expect("protected target should be selected");

        assert_eq!(resolved.id, "protected");
        assert_eq!(
            resolved
                .occluding_windows
                .iter()
                .map(|target| target.id.as_str())
                .collect::<Vec<_>>(),
            vec!["occluder"]
        );
    }
}
