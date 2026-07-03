use anyhow::{anyhow, Result};
use base64::Engine as _;
use image::{imageops, RgbImage};
use scap_targets::Display;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};

use crate::screenshot;

#[cfg(target_os = "windows")]
use std::{thread, time::Duration};

#[cfg(target_os = "windows")]
use windows::core::BOOL;
#[cfg(target_os = "windows")]
use windows::Win32::Foundation::{HWND, LPARAM, POINT, RECT, WPARAM};
#[cfg(target_os = "windows")]
use windows::Win32::UI::Input::KeyboardAndMouse::{
    keybd_event, mouse_event, KEYEVENTF_KEYUP, MOUSEEVENTF_WHEEL, VK_NEXT,
};
#[cfg(target_os = "windows")]
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetAncestor, GetClassNameW, GetCursorPos, GetParent, GetWindowRect,
    GetWindowThreadProcessId, IsWindowVisible, SendMessageW, SetCursorPos, SetForegroundWindow,
    WindowFromPoint, GA_ROOT, SB_PAGEDOWN, WM_MOUSEWHEEL, WM_VSCROLL,
};

#[cfg(target_os = "windows")]
fn rect_contains_point(rect: &RECT, x: i32, y: i32) -> bool {
    x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
}

#[cfg(target_os = "windows")]
unsafe extern "system" fn enum_windows_for_point(window: HWND, lparam: LPARAM) -> BOOL {
    let state = &mut *(lparam.0 as *mut WindowSearchState);
    if state.found.is_some() {
        return false.into();
    }

    if !IsWindowVisible(window).as_bool() {
        return true.into();
    }

    let mut pid = 0u32;
    GetWindowThreadProcessId(window, Some(&mut pid));
    if pid == state.own_pid {
        return true.into();
    }

    let mut rect = RECT::default();
    if !GetWindowRect(window, &mut rect).is_ok() {
        return true.into();
    }

    if rect_contains_point(&rect, state.x, state.y) {
        state.found = Some(window);
        return false.into();
    }

    true.into()
}

#[cfg(target_os = "windows")]
struct WindowSearchState {
    x: i32,
    y: i32,
    own_pid: u32,
    found: Option<HWND>,
}

#[cfg(target_os = "windows")]
#[derive(Clone, Copy)]
struct WindowTarget {
    direct: HWND,
    root: HWND,
}

#[cfg(target_os = "windows")]
fn window_class_name(window: HWND) -> String {
    let mut buffer = [0u16; 256];
    let len = unsafe { GetClassNameW(window, &mut buffer) };
    if len <= 0 {
        return "<unknown>".to_string();
    }
    String::from_utf16_lossy(&buffer[..len as usize])
}

#[cfg(target_os = "windows")]
fn resolve_window_at_point(x: i32, y: i32) -> Option<WindowTarget> {
    let own_pid = std::process::id();
    let direct = unsafe { WindowFromPoint(POINT { x, y }) };
    if !direct.is_invalid() {
        let mut direct_pid = 0u32;
        unsafe {
            GetWindowThreadProcessId(direct, Some(&mut direct_pid));
        }
        if direct_pid != own_pid {
            let root = unsafe { GetAncestor(direct, GA_ROOT) };
            let focus_target = if !root.is_invalid() { root } else { direct };
            return Some(WindowTarget {
                direct,
                root: focus_target,
            });
        }
    }

    let mut state = WindowSearchState {
        x,
        y,
        own_pid,
        found: None,
    };
    unsafe {
        let _ = EnumWindows(
            Some(enum_windows_for_point),
            LPARAM((&mut state as *mut WindowSearchState) as isize),
        );
        if let Some(window) = state.found {
            let root = GetAncestor(window, GA_ROOT);
            let focus_target = if !root.is_invalid() { root } else { window };
            return Some(WindowTarget {
                direct: window,
                root: focus_target,
            });
        }
    }

    None
}

#[cfg(target_os = "windows")]
fn focus_window_at_point(x: i32, y: i32) -> Option<WindowTarget> {
    let target = resolve_window_at_point(x, y);
    match target {
        Some(target) => {
            crate::append_runtime_log_line(&format!(
                "long_capture focus_target :: x={} y={} direct={:?} direct_class={} root={:?} root_class={}",
                x,
                y,
                target.direct,
                window_class_name(target.direct),
                target.root,
                window_class_name(target.root)
            ));
            unsafe {
                let _ = SetForegroundWindow(target.root);
            }
            Some(target)
        }
        None => {
            crate::append_runtime_log_line(&format!(
                "long_capture focus_target_missing :: x={} y={}",
                x, y
            ));
            None
        }
    }
}

#[cfg(target_os = "windows")]
fn mouse_wheel_wparam(delta: i32) -> WPARAM {
    let delta_word = (delta as i16 as u16 as usize) << 16;
    WPARAM(delta_word)
}

#[cfg(target_os = "windows")]
fn mouse_wheel_lparam(x: i32, y: i32) -> LPARAM {
    let packed = ((y as u16 as u32) << 16) | (x as u16 as u32);
    LPARAM(packed as isize)
}

#[cfg(target_os = "windows")]
fn send_message_scroll_fallback(target: WindowTarget, x: i32, y: i32, delta: i32) -> bool {
    let wheel_wparam = mouse_wheel_wparam(delta);
    let wheel_lparam = mouse_wheel_lparam(x, y);
    let mut current = target.direct;
    let mut attempt = 0usize;
    let mut sent_any = false;

    loop {
        if current.is_invalid() {
            break;
        }

        crate::append_runtime_log_line(&format!(
            "long_capture message_scroll_attempt :: hwnd={:?} class={} attempt={} delta={}",
            current,
            window_class_name(current),
            attempt,
            delta
        ));
        unsafe {
            let _ = SendMessageW(
                current,
                WM_MOUSEWHEEL,
                Some(wheel_wparam),
                Some(wheel_lparam),
            );
            let _ = SendMessageW(
                current,
                WM_VSCROLL,
                Some(WPARAM(SB_PAGEDOWN.0 as usize)),
                Some(LPARAM(0)),
            );
        }
        sent_any = true;

        if current == target.root {
            break;
        }

        let parent = match unsafe { GetParent(current) } {
            Ok(parent) => parent,
            Err(_) => break,
        };
        if parent.is_invalid() || parent == current {
            break;
        }
        current = parent;
        attempt += 1;
        if attempt > 8 {
            break;
        }
    }

    sent_any
}

fn logical_to_primary_physical(x: i32, y: i32) -> (i32, i32) {
    let display = Display::primary();
    let physical = display.physical_size();
    let logical = display.logical_size();
    if let (Some(physical), Some(logical)) = (physical, logical) {
        if logical.width() > 0.0 && logical.height() > 0.0 {
            let scale_x = physical.width() / logical.width();
            let scale_y = physical.height() / logical.height();
            return (
                (x as f64 * scale_x).round() as i32,
                (y as f64 * scale_y).round() as i32,
            );
        }
    }
    (x, y)
}

#[cfg(target_os = "windows")]
fn current_cursor_position() -> Option<(i32, i32)> {
    let mut point = POINT::default();
    if unsafe { GetCursorPos(&mut point) }.is_ok() {
        Some((point.x, point.y))
    } else {
        None
    }
}

#[cfg(target_os = "windows")]
fn scroll_vertical_at_point(x: i32, y: i32, delta: i32) {
    let previous = current_cursor_position();
    let _ = unsafe { SetCursorPos(x, y) };
    let used_messages = focus_window_at_point(x, y)
        .map(|target| send_message_scroll_fallback(target, x, y, delta))
        .unwrap_or(false);
    crate::append_runtime_log_line(&format!(
        "long_capture wheel_scroll :: x={} y={} delta={} used_messages={}",
        x, y, delta, used_messages
    ));
    unsafe {
        mouse_event(MOUSEEVENTF_WHEEL, 0, 0, delta, 0);
    }
    if let Some((previous_x, previous_y)) = previous {
        let _ = unsafe { SetCursorPos(previous_x, previous_y) };
    }
}

#[cfg(target_os = "windows")]
fn page_down_at_point(x: i32, y: i32) {
    let previous = current_cursor_position();
    let _ = unsafe { SetCursorPos(x, y) };
    let target = focus_window_at_point(x, y);
    let used_messages = target
        .map(|target| send_message_scroll_fallback(target, x, y, -120))
        .unwrap_or(false);
    unsafe {
        keybd_event(VK_NEXT.0 as u8, 0, Default::default(), 0);
        keybd_event(VK_NEXT.0 as u8, 0, KEYEVENTF_KEYUP, 0);
    }
    crate::append_runtime_log_line(&format!(
        "long_capture page_down_fallback :: x={} y={} used_messages={}",
        x, y, used_messages
    ));
    if let Some((previous_x, previous_y)) = previous {
        let _ = unsafe { SetCursorPos(previous_x, previous_y) };
    }
}

fn mean_row_distance(row_a: &[u8], row_b: &[u8]) -> f64 {
    row_a
        .iter()
        .zip(row_b.iter())
        .map(|(a, b)| (*a as i32 - *b as i32).unsigned_abs() as f64)
        .sum::<f64>()
        / row_a.len().max(1) as f64
}

pub fn find_vertical_overlap(previous: &RgbImage, current: &RgbImage, max_scan: u32) -> u32 {
    if previous.width() != current.width() || previous.height() == 0 || current.height() == 0 {
        return 0;
    }

    let width_bytes = previous.width() as usize * 3;
    let prev_raw = previous.as_raw();
    let curr_raw = current.as_raw();
    let limit = max_scan.min(previous.height()).min(current.height());
    let mut best_overlap = 0;
    let mut best_score = f64::MAX;

    for overlap in 1..=limit {
        let mut total = 0.0;
        let sample_rows = overlap.min(12);
        for index in 0..sample_rows {
            let prev_y = previous.height() - overlap + index;
            let curr_y = index;
            let prev_start = prev_y as usize * width_bytes;
            let curr_start = curr_y as usize * width_bytes;
            total += mean_row_distance(
                &prev_raw[prev_start..prev_start + width_bytes],
                &curr_raw[curr_start..curr_start + width_bytes],
            );
        }

        let score = total / sample_rows.max(1) as f64;
        if score < best_score {
            best_score = score;
            best_overlap = overlap;
        }
    }

    if best_score <= 12.0 {
        best_overlap
    } else {
        0
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum LongCaptureAxis {
    Vertical,
    Horizontal,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum LongCaptureDirection {
    Down,
    Up,
    Right,
    Left,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum LongCaptureOverlapStatus {
    Duplicate,
    TooSmallMotion,
    Good,
    Weak,
    NoOverlap,
}

#[derive(Clone, Copy, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LongCaptureAnalyzeOptions {
    pub axis: Option<LongCaptureAxis>,
    pub direction: Option<LongCaptureDirection>,
    pub max_scan: Option<u32>,
    pub min_overlap_px: Option<u32>,
    pub min_new_content_px: Option<u32>,
}

#[derive(Clone, Copy, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LongCaptureStitchOptions {
    pub axis: Option<LongCaptureAxis>,
    pub direction: Option<LongCaptureDirection>,
    pub max_scan: Option<u32>,
    pub min_overlap_px: Option<u32>,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LongCaptureOverlapAnalysis {
    pub status: LongCaptureOverlapStatus,
    pub axis: Option<LongCaptureAxis>,
    pub direction: Option<LongCaptureDirection>,
    pub overlap_px: u32,
    pub crop_start_px: u32,
    pub append_px: u32,
    pub confidence: f64,
    pub seam_px: u32,
}

#[derive(Clone, Copy, Debug)]
struct CandidateAnalysis {
    direction: LongCaptureDirection,
    overlap_px: u32,
    crop_start_px: u32,
    append_px: u32,
    confidence: f64,
    mean_diff: f64,
    texture_score: f64,
    content_ratio: f64,
}

fn decode_frame_data_url(frame: &str) -> Result<RgbImage> {
    let payload = frame
        .split_once(',')
        .map(|(_, payload)| payload)
        .unwrap_or(frame);
    let bytes = base64::engine::general_purpose::STANDARD.decode(payload)?;
    Ok(image::load_from_memory(&bytes)?.to_rgb8())
}

fn default_edge_ignore(cross_len: u32) -> u32 {
    if cross_len < 120 {
        0
    } else {
        (cross_len / 20).clamp(4, cross_len / 4)
    }
}

fn pixel_diff_sum(a: [u8; 3], b: [u8; 3]) -> u32 {
    (a[0] as i32 - b[0] as i32).unsigned_abs()
        + (a[1] as i32 - b[1] as i32).unsigned_abs()
        + (a[2] as i32 - b[2] as i32).unsigned_abs()
}

fn sample_count(axis_len: u32) -> u32 {
    axis_len.min(128).max(1)
}

const MAX_CROSS_AXIS_SAMPLES: u32 = 192;

fn sampled_offset(index: u32, count: u32, len: u32) -> u32 {
    if count <= 1 || len <= 1 {
        0
    } else {
        index.saturating_mul(len - 1) / (count - 1)
    }
}

fn sampled_axis_offsets(axis_len: u32, edge_ignore: u32, max_samples: u32) -> Vec<u32> {
    let start = edge_ignore.min(axis_len);
    let end = axis_len.saturating_sub(edge_ignore).max(start);
    if end <= start {
        return Vec::new();
    }

    let len = end - start;
    let count = len.min(max_samples.max(1));
    let mut offsets = Vec::with_capacity(count as usize);
    for index in 0..count {
        let offset = start + sampled_offset(index, count, len);
        if offsets.last().copied() != Some(offset) {
            offsets.push(offset);
        }
    }
    offsets
}

fn sampled_cross_axis_offsets(axis_len: u32, edge_ignore: u32) -> Vec<u32> {
    sampled_axis_offsets(axis_len, edge_ignore, MAX_CROSS_AXIS_SAMPLES)
}

const LINE_SIGNATURE_WINDOW: u32 = 10;

#[derive(Clone, Copy, Debug, Default, Eq, Hash, PartialEq)]
struct RollingLineSignature {
    r: u64,
    g: u64,
    b: u64,
    texture: u64,
    content: u32,
}

impl RollingLineSignature {
    fn add_row(&mut self, image: &RgbImage, line: u32, cross_axis_offsets: &[u32]) {
        for &offset in cross_axis_offsets {
            let pixel = image.get_pixel(offset, line).0;
            self.r += pixel[0] as u64;
            self.g += pixel[1] as u64;
            self.b += pixel[2] as u64;
            self.texture += local_texture_strength(image, offset, line) as u64;
            if is_content_pixel(pixel) {
                self.content += 1;
            }
        }
    }

    fn remove_row(&mut self, image: &RgbImage, line: u32, cross_axis_offsets: &[u32]) {
        for &offset in cross_axis_offsets {
            let pixel = image.get_pixel(offset, line).0;
            self.r -= pixel[0] as u64;
            self.g -= pixel[1] as u64;
            self.b -= pixel[2] as u64;
            self.texture -= local_texture_strength(image, offset, line) as u64;
            if is_content_pixel(pixel) {
                self.content -= 1;
            }
        }
    }

    fn add_column(&mut self, image: &RgbImage, column: u32, cross_axis_offsets: &[u32]) {
        for &offset in cross_axis_offsets {
            let pixel = image.get_pixel(column, offset).0;
            self.r += pixel[0] as u64;
            self.g += pixel[1] as u64;
            self.b += pixel[2] as u64;
            self.texture += local_texture_strength(image, column, offset) as u64;
            if is_content_pixel(pixel) {
                self.content += 1;
            }
        }
    }

    fn remove_column(&mut self, image: &RgbImage, column: u32, cross_axis_offsets: &[u32]) {
        for &offset in cross_axis_offsets {
            let pixel = image.get_pixel(column, offset).0;
            self.r -= pixel[0] as u64;
            self.g -= pixel[1] as u64;
            self.b -= pixel[2] as u64;
            self.texture -= local_texture_strength(image, column, offset) as u64;
            if is_content_pixel(pixel) {
                self.content -= 1;
            }
        }
    }
}

#[derive(Clone, Copy, Debug, Default)]
struct SignatureDeltaHint {
    match_count: usize,
    min_current_line: u32,
}

fn choose_signature_cross_axis_offsets(
    cross_axis_weights: &[f64],
    cross_axis_offsets: &[u32],
) -> Vec<u32> {
    let mut weighted_offsets = cross_axis_offsets
        .iter()
        .copied()
        .filter(|&offset| {
            cross_axis_weights
                .get(offset as usize)
                .copied()
                .unwrap_or(0.0)
                >= 0.35
        })
        .collect::<Vec<_>>();

    if weighted_offsets.len() >= 12 {
        return weighted_offsets;
    }

    if cross_axis_offsets.len() <= 48 {
        return cross_axis_offsets.to_vec();
    }

    let step = (cross_axis_offsets.len() / 48).max(1);
    weighted_offsets = cross_axis_offsets
        .iter()
        .copied()
        .step_by(step)
        .collect::<Vec<_>>();
    if weighted_offsets.last().copied() != cross_axis_offsets.last().copied() {
        if let Some(last) = cross_axis_offsets.last().copied() {
            weighted_offsets.push(last);
        }
    }
    weighted_offsets
}

fn rolling_line_signatures(
    image: &RgbImage,
    cross_axis_offsets: &[u32],
    window: u32,
) -> Vec<Option<RollingLineSignature>> {
    if cross_axis_offsets.is_empty() || image.height() < window || window == 0 {
        return Vec::new();
    }

    let line_count = image.height() as usize;
    let mut signatures = vec![None; line_count];
    let mut rolling = RollingLineSignature::default();

    for line in 0..window {
        rolling.add_row(image, line, cross_axis_offsets);
    }

    let min_texture = (cross_axis_offsets.len() as u64 * window as u64).max(24);
    let min_content = ((cross_axis_offsets.len() as u32 * window) / 20).max(4);
    let last_start = image.height() - window;
    for start in 0..=last_start {
        if rolling.texture >= min_texture && rolling.content >= min_content {
            signatures[start as usize] = Some(rolling);
        }

        if start < last_start {
            rolling.remove_row(image, start, cross_axis_offsets);
            rolling.add_row(image, start + window, cross_axis_offsets);
        }
    }

    signatures
}

fn rolling_column_signatures(
    image: &RgbImage,
    cross_axis_offsets: &[u32],
    window: u32,
) -> Vec<Option<RollingLineSignature>> {
    if cross_axis_offsets.is_empty() || image.width() < window || window == 0 {
        return Vec::new();
    }

    let column_count = image.width() as usize;
    let mut signatures = vec![None; column_count];
    let mut rolling = RollingLineSignature::default();

    for column in 0..window {
        rolling.add_column(image, column, cross_axis_offsets);
    }

    let min_texture = (cross_axis_offsets.len() as u64 * window as u64).max(24);
    let min_content = ((cross_axis_offsets.len() as u32 * window) / 20).max(4);
    let last_start = image.width() - window;
    for start in 0..=last_start {
        if rolling.texture >= min_texture && rolling.content >= min_content {
            signatures[start as usize] = Some(rolling);
        }

        if start < last_start {
            rolling.remove_column(image, start, cross_axis_offsets);
            rolling.add_column(image, start + window, cross_axis_offsets);
        }
    }

    signatures
}

fn find_vertical_down_fixed_chrome_candidate(
    previous: &RgbImage,
    current: &RgbImage,
    max_scan: u32,
    min_overlap_px: u32,
    min_new_content_px: u32,
    cross_axis_weights: &[f64],
    cross_axis_offsets: &[u32],
) -> Option<CandidateAnalysis> {
    let height = previous.height();
    let signature_window = LINE_SIGNATURE_WINDOW.min(height).max(1);
    let signature_offsets =
        choose_signature_cross_axis_offsets(cross_axis_weights, cross_axis_offsets);
    let previous_signatures =
        rolling_line_signatures(previous, &signature_offsets, signature_window);
    let current_signatures = rolling_line_signatures(current, &signature_offsets, signature_window);
    if previous_signatures.is_empty() || current_signatures.is_empty() {
        return None;
    }

    let mut current_signature_rows = HashMap::<RollingLineSignature, Vec<u32>>::new();
    let current_last_start = height - signature_window;
    for start in 0..=current_last_start {
        if let Some(signature) = current_signatures[start as usize] {
            current_signature_rows
                .entry(signature)
                .or_default()
                .push(start);
        }
    }

    let mut delta_hints = HashMap::<u32, SignatureDeltaHint>::new();
    let previous_last_start = height - signature_window;
    for prev_start in 0..=previous_last_start {
        let Some(signature) = previous_signatures[prev_start as usize] else {
            continue;
        };
        let Some(current_starts) = current_signature_rows.get(&signature) else {
            continue;
        };
        for &curr_start in current_starts {
            if prev_start <= curr_start {
                continue;
            }
            let append_px = prev_start - curr_start;
            if append_px < min_new_content_px || append_px > max_scan {
                continue;
            }
            let crop_start_px = height.saturating_sub(append_px);
            if crop_start_px <= curr_start {
                continue;
            }
            let overlap_px = crop_start_px - curr_start;
            if overlap_px < min_overlap_px {
                continue;
            }

            delta_hints
                .entry(append_px)
                .and_modify(|hint| {
                    hint.match_count += 1;
                    hint.min_current_line = hint.min_current_line.min(curr_start);
                })
                .or_insert(SignatureDeltaHint {
                    match_count: 1,
                    min_current_line: curr_start,
                });
        }
    }

    let mut best: Option<CandidateAnalysis> = None;
    for (append_px, hint) in delta_hints {
        if hint.match_count < 2 {
            continue;
        }

        let crop_start_px = height.saturating_sub(append_px);
        if crop_start_px <= hint.min_current_line {
            continue;
        }
        let overlap_px = crop_start_px - hint.min_current_line;
        if overlap_px < min_overlap_px {
            continue;
        }
        let prev_start = height.saturating_sub(overlap_px);
        let (ratio, mean_diff, texture_score, content_ratio) = vertical_overlap_score(
            previous,
            current,
            prev_start,
            hint.min_current_line,
            overlap_px,
            cross_axis_weights,
            cross_axis_offsets,
        );
        let confidence = score_confidence(ratio, mean_diff);
        let candidate = CandidateAnalysis {
            direction: LongCaptureDirection::Down,
            overlap_px,
            crop_start_px,
            append_px,
            confidence: (confidence + (hint.match_count as f64 * 0.015)).clamp(0.0, 1.0),
            mean_diff,
            texture_score,
            content_ratio,
        };
        if best
            .map(|item| candidate_is_better(candidate, item, height, min_new_content_px))
            .unwrap_or(true)
        {
            best = Some(candidate);
        }
    }

    best
}

fn find_vertical_up_fixed_chrome_candidate(
    previous: &RgbImage,
    current: &RgbImage,
    max_scan: u32,
    min_overlap_px: u32,
    min_new_content_px: u32,
    cross_axis_weights: &[f64],
    cross_axis_offsets: &[u32],
) -> Option<CandidateAnalysis> {
    let height = previous.height();
    let signature_window = LINE_SIGNATURE_WINDOW.min(height).max(1);
    let signature_offsets =
        choose_signature_cross_axis_offsets(cross_axis_weights, cross_axis_offsets);
    let previous_signatures =
        rolling_line_signatures(previous, &signature_offsets, signature_window);
    let current_signatures = rolling_line_signatures(current, &signature_offsets, signature_window);
    if previous_signatures.is_empty() || current_signatures.is_empty() {
        return None;
    }

    let mut current_signature_rows = HashMap::<RollingLineSignature, Vec<u32>>::new();
    let current_last_start = height - signature_window;
    for start in 0..=current_last_start {
        if let Some(signature) = current_signatures[start as usize] {
            current_signature_rows
                .entry(signature)
                .or_default()
                .push(start);
        }
    }

    let mut delta_hints = HashMap::<u32, SignatureDeltaHint>::new();
    let previous_last_start = height - signature_window;
    for prev_start in 0..=previous_last_start {
        let Some(signature) = previous_signatures[prev_start as usize] else {
            continue;
        };
        let Some(current_starts) = current_signature_rows.get(&signature) else {
            continue;
        };
        for &curr_start in current_starts {
            if curr_start <= prev_start {
                continue;
            }
            let append_px = curr_start - prev_start;
            if append_px < min_new_content_px || append_px > max_scan {
                continue;
            }
            let overlap_px = height.saturating_sub(append_px);
            if overlap_px < min_overlap_px {
                continue;
            }

            delta_hints
                .entry(append_px)
                .and_modify(|hint| {
                    hint.match_count += 1;
                    hint.min_current_line = hint.min_current_line.min(curr_start);
                })
                .or_insert(SignatureDeltaHint {
                    match_count: 1,
                    min_current_line: curr_start,
                });
        }
    }

    let mut best: Option<CandidateAnalysis> = None;
    for (append_px, hint) in delta_hints {
        if hint.match_count < 2 {
            continue;
        }

        let overlap_px = height.saturating_sub(append_px);
        if overlap_px < min_overlap_px {
            continue;
        }
        let (ratio, mean_diff, texture_score, content_ratio) = vertical_overlap_score(
            previous,
            current,
            0,
            append_px,
            overlap_px,
            cross_axis_weights,
            cross_axis_offsets,
        );
        let confidence = score_confidence(ratio, mean_diff);
        let candidate = CandidateAnalysis {
            direction: LongCaptureDirection::Up,
            overlap_px,
            crop_start_px: append_px,
            append_px,
            confidence: (confidence + (hint.match_count as f64 * 0.015)).clamp(0.0, 1.0),
            mean_diff,
            texture_score,
            content_ratio,
        };
        if best
            .map(|item| candidate_is_better(candidate, item, height, min_new_content_px))
            .unwrap_or(true)
        {
            best = Some(candidate);
        }
    }

    best
}

fn find_horizontal_right_fixed_chrome_candidate(
    previous: &RgbImage,
    current: &RgbImage,
    max_scan: u32,
    min_overlap_px: u32,
    min_new_content_px: u32,
    cross_axis_weights: &[f64],
    cross_axis_offsets: &[u32],
) -> Option<CandidateAnalysis> {
    let width = previous.width();
    let signature_window = LINE_SIGNATURE_WINDOW.min(width).max(1);
    let signature_offsets =
        choose_signature_cross_axis_offsets(cross_axis_weights, cross_axis_offsets);
    let previous_signatures =
        rolling_column_signatures(previous, &signature_offsets, signature_window);
    let current_signatures =
        rolling_column_signatures(current, &signature_offsets, signature_window);
    if previous_signatures.is_empty() || current_signatures.is_empty() {
        return None;
    }

    let mut current_signature_columns = HashMap::<RollingLineSignature, Vec<u32>>::new();
    let current_last_start = width - signature_window;
    for start in 0..=current_last_start {
        if let Some(signature) = current_signatures[start as usize] {
            current_signature_columns
                .entry(signature)
                .or_default()
                .push(start);
        }
    }

    let mut delta_hints = HashMap::<u32, SignatureDeltaHint>::new();
    let previous_last_start = width - signature_window;
    for prev_start in 0..=previous_last_start {
        let Some(signature) = previous_signatures[prev_start as usize] else {
            continue;
        };
        let Some(current_starts) = current_signature_columns.get(&signature) else {
            continue;
        };
        for &curr_start in current_starts {
            if prev_start <= curr_start {
                continue;
            }
            let append_px = prev_start - curr_start;
            if append_px < min_new_content_px || append_px > max_scan {
                continue;
            }
            let crop_start_px = width.saturating_sub(append_px);
            if crop_start_px <= curr_start {
                continue;
            }
            let overlap_px = crop_start_px - curr_start;
            if overlap_px < min_overlap_px {
                continue;
            }

            delta_hints
                .entry(append_px)
                .and_modify(|hint| {
                    hint.match_count += 1;
                    hint.min_current_line = hint.min_current_line.min(curr_start);
                })
                .or_insert(SignatureDeltaHint {
                    match_count: 1,
                    min_current_line: curr_start,
                });
        }
    }

    let mut best: Option<CandidateAnalysis> = None;
    for (append_px, hint) in delta_hints {
        if hint.match_count < 2 {
            continue;
        }

        let crop_start_px = width.saturating_sub(append_px);
        if crop_start_px <= hint.min_current_line {
            continue;
        }
        let overlap_px = crop_start_px - hint.min_current_line;
        if overlap_px < min_overlap_px {
            continue;
        }
        let prev_start = width.saturating_sub(overlap_px);
        let (ratio, mean_diff, texture_score, content_ratio) = horizontal_overlap_score(
            previous,
            current,
            prev_start,
            hint.min_current_line,
            overlap_px,
            cross_axis_weights,
            cross_axis_offsets,
        );
        let confidence = score_confidence(ratio, mean_diff);
        let candidate = CandidateAnalysis {
            direction: LongCaptureDirection::Right,
            overlap_px,
            crop_start_px,
            append_px,
            confidence: (confidence + (hint.match_count as f64 * 0.015)).clamp(0.0, 1.0),
            mean_diff,
            texture_score,
            content_ratio,
        };
        if best
            .map(|item| candidate_is_better(candidate, item, width, min_new_content_px))
            .unwrap_or(true)
        {
            best = Some(candidate);
        }
    }

    best
}

fn find_horizontal_left_fixed_chrome_candidate(
    previous: &RgbImage,
    current: &RgbImage,
    max_scan: u32,
    min_overlap_px: u32,
    min_new_content_px: u32,
    cross_axis_weights: &[f64],
    cross_axis_offsets: &[u32],
) -> Option<CandidateAnalysis> {
    let width = previous.width();
    let signature_window = LINE_SIGNATURE_WINDOW.min(width).max(1);
    let signature_offsets =
        choose_signature_cross_axis_offsets(cross_axis_weights, cross_axis_offsets);
    let previous_signatures =
        rolling_column_signatures(previous, &signature_offsets, signature_window);
    let current_signatures =
        rolling_column_signatures(current, &signature_offsets, signature_window);
    if previous_signatures.is_empty() || current_signatures.is_empty() {
        return None;
    }

    let mut current_signature_columns = HashMap::<RollingLineSignature, Vec<u32>>::new();
    let current_last_start = width - signature_window;
    for start in 0..=current_last_start {
        if let Some(signature) = current_signatures[start as usize] {
            current_signature_columns
                .entry(signature)
                .or_default()
                .push(start);
        }
    }

    let mut delta_hints = HashMap::<u32, SignatureDeltaHint>::new();
    let previous_last_start = width - signature_window;
    for prev_start in 0..=previous_last_start {
        let Some(signature) = previous_signatures[prev_start as usize] else {
            continue;
        };
        let Some(current_starts) = current_signature_columns.get(&signature) else {
            continue;
        };
        for &curr_start in current_starts {
            if curr_start <= prev_start {
                continue;
            }
            let append_px = curr_start - prev_start;
            if append_px < min_new_content_px || append_px > max_scan {
                continue;
            }
            let overlap_px = width.saturating_sub(append_px);
            if overlap_px < min_overlap_px {
                continue;
            }

            delta_hints
                .entry(append_px)
                .and_modify(|hint| {
                    hint.match_count += 1;
                    hint.min_current_line = hint.min_current_line.min(curr_start);
                })
                .or_insert(SignatureDeltaHint {
                    match_count: 1,
                    min_current_line: curr_start,
                });
        }
    }

    let mut best: Option<CandidateAnalysis> = None;
    for (append_px, hint) in delta_hints {
        if hint.match_count < 2 {
            continue;
        }

        let overlap_px = width.saturating_sub(append_px);
        if overlap_px < min_overlap_px {
            continue;
        }
        let (ratio, mean_diff, texture_score, content_ratio) = horizontal_overlap_score(
            previous,
            current,
            0,
            append_px,
            overlap_px,
            cross_axis_weights,
            cross_axis_offsets,
        );
        let confidence = score_confidence(ratio, mean_diff);
        let candidate = CandidateAnalysis {
            direction: LongCaptureDirection::Left,
            overlap_px,
            crop_start_px: append_px,
            append_px,
            confidence: (confidence + (hint.match_count as f64 * 0.015)).clamp(0.0, 1.0),
            mean_diff,
            texture_score,
            content_ratio,
        };
        if best
            .map(|item| candidate_is_better(candidate, item, width, min_new_content_px))
            .unwrap_or(true)
        {
            best = Some(candidate);
        }
    }

    best
}

pub(crate) fn is_near_duplicate_image(previous: &RgbImage, current: &RgbImage) -> bool {
    if previous.width() != current.width() || previous.height() != current.height() {
        return false;
    }

    let x_offsets = sampled_axis_offsets(previous.width(), 0, 64);
    let y_offsets = sampled_axis_offsets(previous.height(), 0, 64);
    if x_offsets.is_empty() || y_offsets.is_empty() {
        return false;
    }

    let mut total = 0u64;
    let mut changed = 0u64;
    let mut diff_total = 0u64;
    let mut max_diff = 0u32;

    for &y in &y_offsets {
        for &x in &x_offsets {
            let diff = pixel_diff_sum(previous.get_pixel(x, y).0, current.get_pixel(x, y).0);
            if diff >= 18 {
                changed += 1;
            }
            max_diff = max_diff.max(diff);
            diff_total += diff as u64;
            total += 1;
        }
    }

    if total == 0 {
        return false;
    }

    let changed_ratio = changed as f64 / total as f64;
    let mean_diff = diff_total as f64 / total as f64;
    changed_ratio <= 0.01 && mean_diff <= 3.0 && max_diff <= 48
}

fn fallback_uniform_weights(weights: &mut [f64], start: u32, end: u32) {
    for index in start..end {
        weights[index as usize] = 1.0;
    }
}

fn dynamic_column_or_row_weight(significant_count: u32, max_diff: u32, sample_count: u32) -> f64 {
    let significant_ratio = significant_count as f64 / sample_count.max(1) as f64;
    let peak_score = (max_diff as f64 / 160.0).clamp(0.0, 1.0);
    (significant_ratio * 1.8 + peak_score * 0.2).clamp(0.0, 1.0)
}

fn candidate_priority(candidate: CandidateAnalysis, axis_len: u32) -> f64 {
    let overlap_ratio = (candidate.overlap_px as f64 / axis_len.max(1) as f64).clamp(0.0, 1.0);
    let diff_score = (1.0 - (candidate.mean_diff / 64.0)).clamp(0.0, 1.0);
    (candidate.confidence * 0.65 + diff_score * 0.25 + overlap_ratio * 0.10).clamp(0.0, 1.0)
}

fn candidate_is_fast_recording_match(
    candidate: CandidateAnalysis,
    min_new_content_px: u32,
    axis_len: u32,
) -> bool {
    let max_fast_append_px = axis_len.saturating_sub(1).min(24).max(min_new_content_px);
    candidate.append_px >= min_new_content_px
        && candidate.append_px <= max_fast_append_px
        && candidate.texture_score >= 24.0
        && candidate.content_ratio >= 0.01
        && candidate.confidence >= 0.88
        && candidate.mean_diff <= 12.0
}

fn vertical_cross_axis_weights(
    previous: &RgbImage,
    current: &RgbImage,
    edge_ignore: u32,
) -> Vec<f64> {
    let width = previous.width();
    let height = previous.height();
    let start_x = edge_ignore.min(width);
    let end_x = width.saturating_sub(edge_ignore).max(start_x);
    let rows = sample_count(height);
    let mut weights = vec![0.0; width as usize];
    let mut total_weight = 0.0;

    for x in start_x..end_x {
        let mut significant_count = 0;
        let mut max_diff = 0;
        for row_index in 0..rows {
            let y = sampled_offset(row_index, rows, height);
            let diff = pixel_diff_sum(previous.get_pixel(x, y).0, current.get_pixel(x, y).0);
            if diff >= 45 {
                significant_count += 1;
            }
            max_diff = max_diff.max(diff);
        }
        let weight = dynamic_column_or_row_weight(significant_count, max_diff, rows);
        weights[x as usize] = weight;
        total_weight += weight;
    }

    if total_weight < 1.0 {
        fallback_uniform_weights(&mut weights, start_x, end_x);
    }

    weights
}

fn horizontal_cross_axis_weights(
    previous: &RgbImage,
    current: &RgbImage,
    edge_ignore: u32,
) -> Vec<f64> {
    let width = previous.width();
    let height = previous.height();
    let start_y = edge_ignore.min(height);
    let end_y = height.saturating_sub(edge_ignore).max(start_y);
    let columns = sample_count(width);
    let mut weights = vec![0.0; height as usize];
    let mut total_weight = 0.0;

    for y in start_y..end_y {
        let mut significant_count = 0;
        let mut max_diff = 0;
        for column_index in 0..columns {
            let x = sampled_offset(column_index, columns, width);
            let diff = pixel_diff_sum(previous.get_pixel(x, y).0, current.get_pixel(x, y).0);
            if diff >= 45 {
                significant_count += 1;
            }
            max_diff = max_diff.max(diff);
        }
        let weight = dynamic_column_or_row_weight(significant_count, max_diff, columns);
        weights[y as usize] = weight;
        total_weight += weight;
    }

    if total_weight < 1.0 {
        fallback_uniform_weights(&mut weights, start_y, end_y);
    }

    weights
}

fn local_texture_strength(image: &RgbImage, x: u32, y: u32) -> u32 {
    let pixel = image.get_pixel(x, y).0;
    let mut strength = 0;

    if x > 0 {
        strength = strength.max(pixel_diff_sum(pixel, image.get_pixel(x - 1, y).0));
    }
    if x + 1 < image.width() {
        strength = strength.max(pixel_diff_sum(pixel, image.get_pixel(x + 1, y).0));
    }
    if y > 0 {
        strength = strength.max(pixel_diff_sum(pixel, image.get_pixel(x, y - 1).0));
    }
    if y + 1 < image.height() {
        strength = strength.max(pixel_diff_sum(pixel, image.get_pixel(x, y + 1).0));
    }

    strength
}

fn color_content_strength(pixel: [u8; 3]) -> u32 {
    let min_channel = pixel[0].min(pixel[1]).min(pixel[2]);
    let max_channel = pixel[0].max(pixel[1]).max(pixel[2]);
    let saturation = (max_channel as i32 - min_channel as i32).unsigned_abs();
    let darkness = 255u32.saturating_sub(max_channel as u32);
    saturation.max(darkness)
}

fn is_content_pixel(pixel: [u8; 3]) -> bool {
    color_content_strength(pixel) >= 18
}

fn pixel_texture_weight(
    previous: &RgbImage,
    current: &RgbImage,
    prev_x: u32,
    prev_y: u32,
    curr_x: u32,
    curr_y: u32,
) -> f64 {
    let strength = local_texture_strength(previous, prev_x, prev_y)
        .max(local_texture_strength(current, curr_x, curr_y))
        .max(color_content_strength(previous.get_pixel(prev_x, prev_y).0))
        .max(color_content_strength(current.get_pixel(curr_x, curr_y).0));
    0.03 + 0.97 * (strength as f64 / 96.0).clamp(0.0, 1.0)
}

fn motion_weight(diff: u32) -> f64 {
    0.02 + 0.98 * (diff as f64 / 96.0).clamp(0.0, 1.0)
}

fn vertical_overlap_score(
    previous: &RgbImage,
    current: &RgbImage,
    prev_y: u32,
    curr_y: u32,
    overlap_len: u32,
    cross_axis_weights: &[f64],
    cross_axis_offsets: &[u32],
) -> (f64, f64, f64, f64) {
    let rows = sample_count(overlap_len);
    let mut matched = 0.0;
    let mut total = 0.0;
    let mut diff_total = 0.0;
    let mut texture_total = 0.0;
    let mut texture_count = 0.0f64;
    let mut content_total = 0.0;

    for row_index in 0..rows {
        let y_offset = sampled_offset(row_index, rows, overlap_len);
        for &x in cross_axis_offsets {
            let weight = cross_axis_weights.get(x as usize).copied().unwrap_or(1.0);
            if weight <= 0.0 {
                continue;
            }
            let diff = pixel_diff_sum(
                previous.get_pixel(x, prev_y + y_offset).0,
                current.get_pixel(x, curr_y + y_offset).0,
            );
            let same_viewport_y = curr_y + y_offset;
            let same_viewport_diff = if same_viewport_y < previous.height() {
                pixel_diff_sum(
                    previous.get_pixel(x, same_viewport_y).0,
                    current.get_pixel(x, same_viewport_y).0,
                )
            } else {
                diff
            };
            let weight = weight
                * pixel_texture_weight(
                    previous,
                    current,
                    x,
                    prev_y + y_offset,
                    x,
                    curr_y + y_offset,
                )
                * motion_weight(same_viewport_diff);
            texture_total += local_texture_strength(previous, x, prev_y + y_offset)
                .max(local_texture_strength(current, x, curr_y + y_offset))
                .max(color_content_strength(
                    previous.get_pixel(x, prev_y + y_offset).0,
                ))
                .max(color_content_strength(
                    current.get_pixel(x, curr_y + y_offset).0,
                )) as f64
                * weight;
            texture_count += weight;
            if is_content_pixel(previous.get_pixel(x, prev_y + y_offset).0)
                || is_content_pixel(current.get_pixel(x, curr_y + y_offset).0)
            {
                content_total += weight;
            }
            if diff <= 30 {
                matched += weight;
            }
            diff_total += diff as f64 * weight;
            total += weight;
        }
    }

    if total <= 0.0 {
        return (0.0, 255.0, 0.0, 0.0);
    }

    (
        matched / total,
        diff_total / total,
        texture_total / texture_count.max(1.0),
        content_total / total,
    )
}

fn horizontal_overlap_score(
    previous: &RgbImage,
    current: &RgbImage,
    prev_x: u32,
    curr_x: u32,
    overlap_len: u32,
    cross_axis_weights: &[f64],
    cross_axis_offsets: &[u32],
) -> (f64, f64, f64, f64) {
    let columns = sample_count(overlap_len);
    let mut matched = 0.0;
    let mut total = 0.0;
    let mut diff_total = 0.0;
    let mut texture_total = 0.0;
    let mut texture_count = 0.0f64;
    let mut content_total = 0.0;

    for column_index in 0..columns {
        let x_offset = sampled_offset(column_index, columns, overlap_len);
        for &y in cross_axis_offsets {
            let weight = cross_axis_weights.get(y as usize).copied().unwrap_or(1.0);
            if weight <= 0.0 {
                continue;
            }
            let diff = pixel_diff_sum(
                previous.get_pixel(prev_x + x_offset, y).0,
                current.get_pixel(curr_x + x_offset, y).0,
            );
            let same_viewport_x = curr_x + x_offset;
            let same_viewport_diff = if same_viewport_x < previous.width() {
                pixel_diff_sum(
                    previous.get_pixel(same_viewport_x, y).0,
                    current.get_pixel(same_viewport_x, y).0,
                )
            } else {
                diff
            };
            let weight = weight
                * pixel_texture_weight(
                    previous,
                    current,
                    prev_x + x_offset,
                    y,
                    curr_x + x_offset,
                    y,
                )
                * motion_weight(same_viewport_diff);
            texture_total += local_texture_strength(previous, prev_x + x_offset, y)
                .max(local_texture_strength(current, curr_x + x_offset, y))
                .max(color_content_strength(
                    previous.get_pixel(prev_x + x_offset, y).0,
                ))
                .max(color_content_strength(
                    current.get_pixel(curr_x + x_offset, y).0,
                )) as f64
                * weight;
            texture_count += weight;
            if is_content_pixel(previous.get_pixel(prev_x + x_offset, y).0)
                || is_content_pixel(current.get_pixel(curr_x + x_offset, y).0)
            {
                content_total += weight;
            }
            if diff <= 30 {
                matched += weight;
            }
            diff_total += diff as f64 * weight;
            total += weight;
        }
    }

    if total <= 0.0 {
        return (0.0, 255.0, 0.0, 0.0);
    }

    (
        matched / total,
        diff_total / total,
        texture_total / texture_count.max(1.0),
        content_total / total,
    )
}

fn score_confidence(match_ratio: f64, mean_diff: f64) -> f64 {
    let diff_score = (1.0 - (mean_diff / 64.0)).clamp(0.0, 1.0);
    (0.70 * match_ratio + 0.30 * diff_score).clamp(0.0, 1.0)
}

fn default_min_overlap_px(axis_len: u32, max_scan: u32) -> u32 {
    if axis_len <= 12 {
        1
    } else {
        ((axis_len as f64) * 0.03)
            .round()
            .max(16.0)
            .min(max_scan as f64)
            .max(1.0) as u32
    }
}

fn candidate_is_better(
    candidate: CandidateAnalysis,
    current: CandidateAnalysis,
    axis_len: u32,
    min_new_content_px: u32,
) -> bool {
    let candidate_actionable = candidate.append_px >= min_new_content_px;
    let current_actionable = current.append_px >= min_new_content_px;
    match (candidate_actionable, current_actionable) {
        (true, false) => return true,
        (false, true) => return false,
        _ => {}
    }

    let candidate_good = candidate.confidence >= 0.88 && candidate.mean_diff <= 12.0;
    let current_good = current.confidence >= 0.88 && current.mean_diff <= 12.0;
    let candidate_rank = candidate_priority(candidate, axis_len);
    let current_rank = candidate_priority(current, axis_len);

    match (candidate_good, current_good) {
        (true, false) => true,
        (false, true) => false,
        _ => {
            candidate_rank > current_rank + 0.01
                || ((candidate_rank - current_rank).abs() <= 0.01
                    && candidate.overlap_px > current.overlap_px)
        }
    }
}

fn analyze_vertical_direction(
    previous: &RgbImage,
    current: &RgbImage,
    direction: LongCaptureDirection,
    max_scan: u32,
    min_overlap_px: u32,
    min_new_content_px: u32,
) -> Option<CandidateAnalysis> {
    if previous.width() != current.width() || previous.height() != current.height() {
        return None;
    }

    let height = previous.height();
    if height == 0 {
        return None;
    }

    let limit = max_scan.min(height.saturating_sub(1)).max(1);
    let min_overlap = min_overlap_px.min(limit).max(1);
    let edge_ignore = default_edge_ignore(previous.width());
    let cross_axis_weights = vertical_cross_axis_weights(previous, current, edge_ignore);
    let cross_axis_offsets = sampled_cross_axis_offsets(previous.width(), edge_ignore);
    let mut best: Option<CandidateAnalysis> = None;

    match direction {
        LongCaptureDirection::Down => {
            if let Some(candidate) = find_vertical_down_fixed_chrome_candidate(
                previous,
                current,
                max_scan,
                min_overlap,
                min_new_content_px,
                &cross_axis_weights,
                &cross_axis_offsets,
            ) {
                if candidate_is_fast_recording_match(candidate, min_new_content_px, height) {
                    return Some(candidate);
                }
                best = Some(candidate);
            }
            for overlap_px in min_overlap..=limit {
                let prev_start = height.saturating_sub(overlap_px);
                let (ratio, mean_diff, texture_score, content_ratio) = vertical_overlap_score(
                    previous,
                    current,
                    prev_start,
                    0,
                    overlap_px,
                    &cross_axis_weights,
                    &cross_axis_offsets,
                );
                let confidence = score_confidence(ratio, mean_diff);
                let append_px = height.saturating_sub(overlap_px);
                let candidate = CandidateAnalysis {
                    direction,
                    overlap_px,
                    crop_start_px: overlap_px,
                    append_px,
                    confidence,
                    mean_diff,
                    texture_score,
                    content_ratio,
                };
                if best
                    .map(|item| candidate_is_better(candidate, item, height, min_new_content_px))
                    .unwrap_or(true)
                {
                    best = Some(candidate);
                }
            }
        }
        LongCaptureDirection::Up => {
            if let Some(candidate) = find_vertical_up_fixed_chrome_candidate(
                previous,
                current,
                max_scan,
                min_overlap,
                min_new_content_px,
                &cross_axis_weights,
                &cross_axis_offsets,
            ) {
                if candidate_is_fast_recording_match(candidate, min_new_content_px, height) {
                    return Some(candidate);
                }
                best = Some(candidate);
            }
            let search_start = height.saturating_sub(limit);
            let search_end = height.saturating_sub(min_overlap);
            for curr_start in search_start..=search_end {
                let overlap_px = height.saturating_sub(curr_start);
                let (ratio, mean_diff, texture_score, content_ratio) = vertical_overlap_score(
                    previous,
                    current,
                    0,
                    curr_start,
                    overlap_px,
                    &cross_axis_weights,
                    &cross_axis_offsets,
                );
                let confidence = score_confidence(ratio, mean_diff);
                let append_px = curr_start;
                let candidate = CandidateAnalysis {
                    direction,
                    overlap_px,
                    crop_start_px: curr_start,
                    append_px,
                    confidence,
                    mean_diff,
                    texture_score,
                    content_ratio,
                };
                if best
                    .map(|item| candidate_is_better(candidate, item, height, min_new_content_px))
                    .unwrap_or(true)
                {
                    best = Some(candidate);
                }
            }
        }
        LongCaptureDirection::Right | LongCaptureDirection::Left => return None,
    }

    best
}

fn analyze_horizontal_direction(
    previous: &RgbImage,
    current: &RgbImage,
    direction: LongCaptureDirection,
    max_scan: u32,
    min_overlap_px: u32,
    min_new_content_px: u32,
) -> Option<CandidateAnalysis> {
    if previous.width() != current.width() || previous.height() != current.height() {
        return None;
    }

    let width = previous.width();
    if width == 0 {
        return None;
    }

    let limit = max_scan.min(width.saturating_sub(1)).max(1);
    let min_overlap = min_overlap_px.min(limit).max(1);
    let edge_ignore = default_edge_ignore(previous.height());
    let cross_axis_weights = horizontal_cross_axis_weights(previous, current, edge_ignore);
    let cross_axis_offsets = sampled_cross_axis_offsets(previous.height(), edge_ignore);
    let mut best: Option<CandidateAnalysis> = None;

    match direction {
        LongCaptureDirection::Right => {
            if let Some(candidate) = find_horizontal_right_fixed_chrome_candidate(
                previous,
                current,
                max_scan,
                min_overlap,
                min_new_content_px,
                &cross_axis_weights,
                &cross_axis_offsets,
            ) {
                if candidate_is_fast_recording_match(candidate, min_new_content_px, width) {
                    return Some(candidate);
                }
                best = Some(candidate);
            }
            for overlap_px in min_overlap..=limit {
                let prev_start = width.saturating_sub(overlap_px);
                let (ratio, mean_diff, texture_score, content_ratio) = horizontal_overlap_score(
                    previous,
                    current,
                    prev_start,
                    0,
                    overlap_px,
                    &cross_axis_weights,
                    &cross_axis_offsets,
                );
                let confidence = score_confidence(ratio, mean_diff);
                let append_px = width.saturating_sub(overlap_px);
                let candidate = CandidateAnalysis {
                    direction,
                    overlap_px,
                    crop_start_px: overlap_px,
                    append_px,
                    confidence,
                    mean_diff,
                    texture_score,
                    content_ratio,
                };
                if best
                    .map(|item| candidate_is_better(candidate, item, width, min_new_content_px))
                    .unwrap_or(true)
                {
                    best = Some(candidate);
                }
            }
        }
        LongCaptureDirection::Left => {
            if let Some(candidate) = find_horizontal_left_fixed_chrome_candidate(
                previous,
                current,
                max_scan,
                min_overlap,
                min_new_content_px,
                &cross_axis_weights,
                &cross_axis_offsets,
            ) {
                if candidate_is_fast_recording_match(candidate, min_new_content_px, width) {
                    return Some(candidate);
                }
                best = Some(candidate);
            }
            let search_start = width.saturating_sub(limit);
            let search_end = width.saturating_sub(min_overlap);
            for curr_start in search_start..=search_end {
                let overlap_px = width.saturating_sub(curr_start);
                let (ratio, mean_diff, texture_score, content_ratio) = horizontal_overlap_score(
                    previous,
                    current,
                    0,
                    curr_start,
                    overlap_px,
                    &cross_axis_weights,
                    &cross_axis_offsets,
                );
                let confidence = score_confidence(ratio, mean_diff);
                let append_px = curr_start;
                let candidate = CandidateAnalysis {
                    direction,
                    overlap_px,
                    crop_start_px: curr_start,
                    append_px,
                    confidence,
                    mean_diff,
                    texture_score,
                    content_ratio,
                };
                if best
                    .map(|item| candidate_is_better(candidate, item, width, min_new_content_px))
                    .unwrap_or(true)
                {
                    best = Some(candidate);
                }
            }
        }
        LongCaptureDirection::Down | LongCaptureDirection::Up => return None,
    }

    best
}

fn direction_axis(direction: LongCaptureDirection) -> LongCaptureAxis {
    match direction {
        LongCaptureDirection::Down | LongCaptureDirection::Up => LongCaptureAxis::Vertical,
        LongCaptureDirection::Right | LongCaptureDirection::Left => LongCaptureAxis::Horizontal,
    }
}

fn candidate_directions(
    axis: Option<LongCaptureAxis>,
    direction: Option<LongCaptureDirection>,
) -> Vec<LongCaptureDirection> {
    if let Some(direction) = direction {
        return vec![direction];
    }

    match axis {
        Some(LongCaptureAxis::Vertical) => {
            vec![LongCaptureDirection::Down, LongCaptureDirection::Up]
        }
        Some(LongCaptureAxis::Horizontal) => {
            vec![LongCaptureDirection::Right, LongCaptureDirection::Left]
        }
        None => vec![
            LongCaptureDirection::Down,
            LongCaptureDirection::Up,
            LongCaptureDirection::Right,
            LongCaptureDirection::Left,
        ],
    }
}

fn classify_candidate(
    candidate: CandidateAnalysis,
    axis: LongCaptureAxis,
    min_new_content_px: u32,
) -> LongCaptureOverlapAnalysis {
    let has_texture_signal = candidate.texture_score >= 24.0 && candidate.content_ratio >= 0.01;
    let status =
        if has_texture_signal && candidate.confidence >= 0.88 && candidate.mean_diff <= 12.0 {
            if candidate.append_px < min_new_content_px {
                LongCaptureOverlapStatus::TooSmallMotion
            } else {
                LongCaptureOverlapStatus::Good
            }
        } else if has_texture_signal && candidate.confidence >= 0.65 {
            if candidate.append_px < min_new_content_px {
                LongCaptureOverlapStatus::TooSmallMotion
            } else {
                LongCaptureOverlapStatus::Weak
            }
        } else {
            LongCaptureOverlapStatus::NoOverlap
        };

    LongCaptureOverlapAnalysis {
        status,
        axis: Some(axis),
        direction: Some(candidate.direction),
        overlap_px: candidate.overlap_px,
        crop_start_px: candidate.crop_start_px,
        append_px: candidate.append_px,
        confidence: candidate.confidence,
        seam_px: candidate.crop_start_px,
    }
}

fn analyze_axis_candidate(
    previous: &RgbImage,
    current: &RgbImage,
    axis: LongCaptureAxis,
    directions: &[LongCaptureDirection],
    max_scan: u32,
    min_overlap_px: Option<u32>,
    min_new_content_px: u32,
) -> Option<CandidateAnalysis> {
    let axis_len = match axis {
        LongCaptureAxis::Vertical => previous.height(),
        LongCaptureAxis::Horizontal => previous.width(),
    };
    let min_overlap_px =
        min_overlap_px.unwrap_or_else(|| default_min_overlap_px(axis_len, max_scan));
    let mut best: Option<CandidateAnalysis> = None;

    for &direction in directions {
        let candidate = match axis {
            LongCaptureAxis::Vertical => analyze_vertical_direction(
                previous,
                current,
                direction,
                max_scan,
                min_overlap_px,
                min_new_content_px,
            ),
            LongCaptureAxis::Horizontal => analyze_horizontal_direction(
                previous,
                current,
                direction,
                max_scan,
                min_overlap_px,
                min_new_content_px,
            ),
        };

        if let Some(candidate) = candidate {
            if best
                .map(|item| candidate_is_better(candidate, item, axis_len, min_new_content_px))
                .unwrap_or(true)
            {
                best = Some(candidate);
            }
        }
    }

    best
}

fn analysis_confirms_axis(analysis: &LongCaptureOverlapAnalysis, axis_len: u32) -> bool {
    matches!(
        analysis.status,
        LongCaptureOverlapStatus::Good | LongCaptureOverlapStatus::TooSmallMotion
    ) && analysis.overlap_px.saturating_mul(2) >= axis_len
}

fn analyze_auto_axis_by_image_content(
    previous: &RgbImage,
    current: &RgbImage,
    max_scan: u32,
    min_overlap_px: Option<u32>,
    min_new_content_px: u32,
) -> Option<LongCaptureOverlapAnalysis> {
    const VERTICAL_DIRECTIONS: [LongCaptureDirection; 2] =
        [LongCaptureDirection::Down, LongCaptureDirection::Up];
    const HORIZONTAL_DIRECTIONS: [LongCaptureDirection; 2] =
        [LongCaptureDirection::Right, LongCaptureDirection::Left];

    if let Some(candidate) = analyze_axis_candidate(
        previous,
        current,
        LongCaptureAxis::Vertical,
        &VERTICAL_DIRECTIONS,
        max_scan,
        min_overlap_px,
        min_new_content_px,
    ) {
        let analysis = classify_candidate(candidate, LongCaptureAxis::Vertical, min_new_content_px);
        if analysis_confirms_axis(&analysis, previous.height()) {
            return Some(analysis);
        }
    }

    if let Some(candidate) = analyze_axis_candidate(
        previous,
        current,
        LongCaptureAxis::Horizontal,
        &HORIZONTAL_DIRECTIONS,
        max_scan,
        min_overlap_px,
        min_new_content_px,
    ) {
        let analysis =
            classify_candidate(candidate, LongCaptureAxis::Horizontal, min_new_content_px);
        if analysis_confirms_axis(&analysis, previous.width()) {
            return Some(analysis);
        }
    }

    None
}

pub fn analyze_long_capture_pair_images(
    previous: &RgbImage,
    current: &RgbImage,
    options: LongCaptureAnalyzeOptions,
) -> LongCaptureOverlapAnalysis {
    if previous.width() != current.width() || previous.height() != current.height() {
        return LongCaptureOverlapAnalysis {
            status: LongCaptureOverlapStatus::NoOverlap,
            axis: options.axis,
            direction: options.direction,
            overlap_px: 0,
            crop_start_px: 0,
            append_px: 0,
            confidence: 0.0,
            seam_px: 0,
        };
    }

    if previous.as_raw() == current.as_raw() {
        return LongCaptureOverlapAnalysis {
            status: LongCaptureOverlapStatus::Duplicate,
            axis: options.axis,
            direction: options.direction,
            overlap_px: previous.height().max(previous.width()),
            crop_start_px: 0,
            append_px: 0,
            confidence: 1.0,
            seam_px: 0,
        };
    }
    if is_near_duplicate_image(previous, current) {
        return LongCaptureOverlapAnalysis {
            status: LongCaptureOverlapStatus::Duplicate,
            axis: options.axis,
            direction: options.direction,
            overlap_px: previous.height().max(previous.width()),
            crop_start_px: 0,
            append_px: 0,
            confidence: 0.99,
            seam_px: 0,
        };
    }

    let max_dimension = previous.height().max(previous.width());
    let max_scan = options
        .max_scan
        .unwrap_or_else(|| max_dimension.saturating_sub(1).max(1))
        .clamp(1, max_dimension.saturating_sub(1).max(1));
    let min_new_content_px = options.min_new_content_px.unwrap_or(8);

    if options.axis.is_none() && options.direction.is_none() {
        return analyze_auto_axis_by_image_content(
            previous,
            current,
            max_scan,
            options.min_overlap_px,
            min_new_content_px,
        )
        .unwrap_or(LongCaptureOverlapAnalysis {
            status: LongCaptureOverlapStatus::NoOverlap,
            axis: None,
            direction: None,
            overlap_px: 0,
            crop_start_px: 0,
            append_px: 0,
            confidence: 0.0,
            seam_px: 0,
        });
    }

    let mut best: Option<(LongCaptureAxis, CandidateAnalysis)> = None;
    for direction in candidate_directions(options.axis, options.direction) {
        let candidate_axis = direction_axis(direction);
        let axis_len = match candidate_axis {
            LongCaptureAxis::Vertical => previous.height(),
            LongCaptureAxis::Horizontal => previous.width(),
        };
        let min_overlap_px = options
            .min_overlap_px
            .unwrap_or_else(|| default_min_overlap_px(axis_len, max_scan));
        let candidate = match candidate_axis {
            LongCaptureAxis::Vertical => analyze_vertical_direction(
                previous,
                current,
                direction,
                max_scan,
                min_overlap_px,
                min_new_content_px,
            ),
            LongCaptureAxis::Horizontal => analyze_horizontal_direction(
                previous,
                current,
                direction,
                max_scan,
                min_overlap_px,
                min_new_content_px,
            ),
        };

        if let Some(candidate) = candidate {
            let axis = direction_axis(candidate.direction);
            if best
                .map(|(_, item)| candidate_is_better(candidate, item, axis_len, min_new_content_px))
                .unwrap_or(true)
            {
                best = Some((axis, candidate));
            }
        }
    }

    best.map(|(axis, candidate)| classify_candidate(candidate, axis, min_new_content_px))
        .unwrap_or(LongCaptureOverlapAnalysis {
            status: LongCaptureOverlapStatus::NoOverlap,
            axis: options.axis,
            direction: options.direction,
            overlap_px: 0,
            crop_start_px: 0,
            append_px: 0,
            confidence: 0.0,
            seam_px: 0,
        })
}

pub fn analyze_long_capture_pair_data_urls(
    previous: &str,
    current: &str,
    options: LongCaptureAnalyzeOptions,
) -> Result<LongCaptureOverlapAnalysis> {
    let previous = decode_frame_data_url(previous)?;
    let current = decode_frame_data_url(current)?;
    Ok(analyze_long_capture_pair_images(
        &previous, &current, options,
    ))
}

fn frame_axis_len(frame: &RgbImage, axis: LongCaptureAxis) -> i64 {
    match axis {
        LongCaptureAxis::Vertical => frame.height() as i64,
        LongCaptureAxis::Horizontal => frame.width() as i64,
    }
}

fn crop_axis_segment(
    image: &RgbImage,
    axis: LongCaptureAxis,
    local_start: i64,
    len: i64,
) -> Result<RgbImage> {
    if local_start < 0 || len <= 0 {
        return Err(anyhow!("Invalid long-capture crop segment"));
    }
    match axis {
        LongCaptureAxis::Vertical => {
            let y = local_start as u32;
            let height = len as u32;
            if y.saturating_add(height) > image.height() {
                return Err(anyhow!("Vertical long-capture crop is out of bounds"));
            }
            Ok(imageops::crop_imm(image, 0, y, image.width(), height).to_image())
        }
        LongCaptureAxis::Horizontal => {
            let x = local_start as u32;
            let width = len as u32;
            if x.saturating_add(width) > image.width() {
                return Err(anyhow!("Horizontal long-capture crop is out of bounds"));
            }
            Ok(imageops::crop_imm(image, x, 0, width, image.height()).to_image())
        }
    }
}

fn axis_segment_cross_len(image: &RgbImage, axis: LongCaptureAxis) -> u32 {
    match axis {
        LongCaptureAxis::Vertical => image.width(),
        LongCaptureAxis::Horizontal => image.height(),
    }
}

fn axis_segment_len(image: &RgbImage, axis: LongCaptureAxis) -> u32 {
    match axis {
        LongCaptureAxis::Vertical => image.height(),
        LongCaptureAxis::Horizontal => image.width(),
    }
}

fn concatenate_axis_segments(segments: &VecDeque<RgbImage>, axis: LongCaptureAxis) -> RgbImage {
    let Some(first) = segments.front() else {
        return RgbImage::new(0, 0);
    };
    match axis {
        LongCaptureAxis::Vertical => {
            let width = first.width();
            let height = segments.iter().map(RgbImage::height).sum();
            let mut image = RgbImage::new(width, height);
            let mut y = 0i64;
            for segment in segments {
                imageops::replace(&mut image, segment, 0, y);
                y += segment.height() as i64;
            }
            image
        }
        LongCaptureAxis::Horizontal => {
            let width = segments.iter().map(RgbImage::width).sum();
            let height = first.height();
            let mut image = RgbImage::new(width, height);
            let mut x = 0i64;
            for segment in segments {
                imageops::replace(&mut image, segment, x, 0);
                x += segment.width() as i64;
            }
            image
        }
    }
}

fn aggregate_to_image(aggregate: &LongCaptureAggregate, axis: LongCaptureAxis) -> RgbImage {
    if aggregate.segments.len() == 1 {
        return aggregate
            .segments
            .front()
            .cloned()
            .unwrap_or_else(|| RgbImage::new(0, 0));
    }
    concatenate_axis_segments(&aggregate.segments, axis)
}

fn aggregate_into_image(mut aggregate: LongCaptureAggregate) -> RgbImage {
    if let Some(axis) = aggregate.axis {
        return concatenate_axis_segments(&aggregate.segments, axis);
    }
    aggregate
        .segments
        .pop_front()
        .unwrap_or_else(|| RgbImage::new(0, 0))
}

fn aggregate_axis_len(aggregate: &LongCaptureAggregate, axis: LongCaptureAxis) -> u32 {
    aggregate
        .signatures
        .as_ref()
        .filter(|signatures| {
            signatures.cross_len
                == aggregate
                    .segments
                    .front()
                    .map(|segment| axis_segment_cross_len(segment, axis))
                    .unwrap_or(0)
        })
        .map(|signatures| signatures.axis_len)
        .unwrap_or_else(|| {
            aggregate
                .segments
                .iter()
                .map(|segment| axis_segment_len(segment, axis))
                .sum()
        })
}

fn push_aggregate_segment(
    aggregate: &mut LongCaptureAggregate,
    segment: RgbImage,
    axis: LongCaptureAxis,
    prepend: bool,
) -> Result<()> {
    if segment.width() == 0 || segment.height() == 0 {
        return Ok(());
    }
    if let Some(first) = aggregate.segments.front() {
        let expected_cross = axis_segment_cross_len(first, axis);
        let actual_cross = axis_segment_cross_len(&segment, axis);
        if expected_cross != actual_cross {
            return Err(anyhow!("Long-capture aggregate segment size mismatch"));
        }
    }
    if prepend {
        aggregate.segments.push_front(segment);
    } else {
        aggregate.segments.push_back(segment);
    }
    Ok(())
}

fn crop_aggregate_boundary(
    aggregate: &LongCaptureAggregate,
    axis: LongCaptureAxis,
    direction: LongCaptureDirection,
    len: u32,
) -> Option<RgbImage> {
    if len == 0 || len > aggregate_axis_len(aggregate, axis) {
        return None;
    }

    let first = aggregate.segments.front()?;
    match axis {
        LongCaptureAxis::Vertical => {
            let width = first.width();
            let mut output = RgbImage::new(width, len);
            if direction == LongCaptureDirection::Down {
                let mut remaining = len;
                let mut output_y = len;
                for segment in aggregate.segments.iter().rev() {
                    if remaining == 0 {
                        break;
                    }
                    let take = remaining.min(segment.height());
                    output_y -= take;
                    let crop = imageops::crop_imm(
                        segment,
                        0,
                        segment.height().saturating_sub(take),
                        width,
                        take,
                    )
                    .to_image();
                    imageops::replace(&mut output, &crop, 0, output_y as i64);
                    remaining -= take;
                }
            } else {
                let mut remaining = len;
                let mut output_y = 0u32;
                for segment in &aggregate.segments {
                    if remaining == 0 {
                        break;
                    }
                    let take = remaining.min(segment.height());
                    let crop = imageops::crop_imm(segment, 0, 0, width, take).to_image();
                    imageops::replace(&mut output, &crop, 0, output_y as i64);
                    output_y += take;
                    remaining -= take;
                }
            }
            Some(output)
        }
        LongCaptureAxis::Horizontal => {
            let height = first.height();
            let mut output = RgbImage::new(len, height);
            if direction == LongCaptureDirection::Right {
                let mut remaining = len;
                let mut output_x = len;
                for segment in aggregate.segments.iter().rev() {
                    if remaining == 0 {
                        break;
                    }
                    let take = remaining.min(segment.width());
                    output_x -= take;
                    let crop = imageops::crop_imm(
                        segment,
                        segment.width().saturating_sub(take),
                        0,
                        take,
                        height,
                    )
                    .to_image();
                    imageops::replace(&mut output, &crop, output_x as i64, 0);
                    remaining -= take;
                }
            } else {
                let mut remaining = len;
                let mut output_x = 0u32;
                for segment in &aggregate.segments {
                    if remaining == 0 {
                        break;
                    }
                    let take = remaining.min(segment.width());
                    let crop = imageops::crop_imm(segment, 0, 0, take, height).to_image();
                    imageops::replace(&mut output, &crop, output_x as i64, 0);
                    output_x += take;
                    remaining -= take;
                }
            }
            Some(output)
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
struct AxisLineSignature {
    r: u64,
    g: u64,
    b: u64,
    hash: u64,
    texture: u64,
    content: u32,
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
struct AxisWindowSignature {
    r: u64,
    g: u64,
    b: u64,
    hash: u64,
    texture: u64,
    content: u32,
}

#[derive(Clone, Debug)]
struct AxisSignatureList {
    axis_len: u32,
    cross_len: u32,
    window_size: u32,
    windows: Vec<AxisWindowSignature>,
    informative_positions: HashMap<AxisWindowSignature, Vec<u32>>,
}

#[derive(Clone, Copy, Debug)]
struct AggregateMatch {
    origin: i64,
    overlap_px: i64,
    prepend_px: i64,
    append_px: i64,
    match_windows: u32,
    overlap_windows: u32,
}

#[derive(Clone, Debug)]
struct AggregateMatchCandidate {
    matched: AggregateMatch,
    current_signatures: AxisSignatureList,
}

#[derive(Clone, Debug)]
struct LongCaptureAggregate {
    axis: Option<LongCaptureAxis>,
    origin: i64,
    segments: VecDeque<RgbImage>,
    signatures: Option<AxisSignatureList>,
}

#[derive(Clone, Debug)]
struct LongCaptureAggregateResult {
    image: RgbImage,
    axis: Option<LongCaptureAxis>,
    merged_frames: usize,
    skipped_frames: usize,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum DirectionReferenceSource {
    Merged,
    CoveredSkip,
}

#[derive(Clone, Debug)]
pub struct LongCaptureIncrementalStitcher {
    options: LongCaptureStitchOptions,
    aggregate: LongCaptureAggregate,
    frame_count: usize,
    merged_frames: usize,
    skipped_frames: usize,
    adjacent_fast_path_merges: usize,
    aggregate_signature_searches: usize,
    expensive_adjacent_pair_analyses: usize,
    last_direction_reference_signatures:
        Option<(LongCaptureAxis, AxisSignatureList, DirectionReferenceSource)>,
}

#[derive(Clone, Debug)]
pub(crate) struct LongCaptureMotionFingerprint {
    width: u32,
    height: u32,
    vertical: AxisSignatureList,
    horizontal: AxisSignatureList,
}

const AGGREGATE_SIGNATURE_WINDOW: u32 = 10;

fn signature_hash_mix(mut hash: u64, value: u64) -> u64 {
    hash ^= value.wrapping_add(0x9e37_79b9_7f4a_7c15);
    hash = hash.wrapping_mul(0x1000_0000_01b3);
    hash.rotate_left(13)
}

fn aggregate_signature_cross_axis_offsets(image: &RgbImage, axis: LongCaptureAxis) -> Vec<u32> {
    let cross_len = match axis {
        LongCaptureAxis::Vertical => image.width(),
        LongCaptureAxis::Horizontal => image.height(),
    };
    let edge_ignore = if cross_len >= 160 {
        default_edge_ignore(cross_len).max(24).min(cross_len / 4)
    } else {
        default_edge_ignore(cross_len)
    };
    let offsets = sampled_cross_axis_offsets(cross_len, edge_ignore);
    if offsets.is_empty() {
        sampled_cross_axis_offsets(cross_len, 0)
    } else {
        offsets
    }
}

fn axis_line_signature(
    image: &RgbImage,
    axis: LongCaptureAxis,
    index: u32,
    cross_axis_offsets: &[u32],
) -> AxisLineSignature {
    let mut r = 0u64;
    let mut g = 0u64;
    let mut b = 0u64;
    let mut hash = 0xcbf2_9ce4_8422_2325u64;
    let mut texture = 0u64;
    let mut content = 0u32;

    match axis {
        LongCaptureAxis::Vertical => {
            for &x in cross_axis_offsets {
                let pixel = image.get_pixel(x, index).0;
                r += pixel[0] as u64;
                g += pixel[1] as u64;
                b += pixel[2] as u64;
                texture += local_texture_strength(image, x, index) as u64;
                if is_content_pixel(pixel) {
                    content += 1;
                }
                let packed = ((pixel[0] as u64) << 16) | ((pixel[1] as u64) << 8) | pixel[2] as u64;
                hash = signature_hash_mix(hash, packed ^ x as u64);
            }
        }
        LongCaptureAxis::Horizontal => {
            for &y in cross_axis_offsets {
                let pixel = image.get_pixel(index, y).0;
                r += pixel[0] as u64;
                g += pixel[1] as u64;
                b += pixel[2] as u64;
                texture += local_texture_strength(image, index, y) as u64;
                if is_content_pixel(pixel) {
                    content += 1;
                }
                let packed = ((pixel[0] as u64) << 16) | ((pixel[1] as u64) << 8) | pixel[2] as u64;
                hash = signature_hash_mix(hash, packed ^ y as u64);
            }
        }
    }

    AxisLineSignature {
        r,
        g,
        b,
        hash,
        texture,
        content,
    }
}

fn aggregate_window_signature_is_informative(signature: &AxisWindowSignature) -> bool {
    signature.content > 0 || signature.texture >= 24
}

fn axis_signature_list(image: &RgbImage, axis: LongCaptureAxis) -> AxisSignatureList {
    let axis_len = match axis {
        LongCaptureAxis::Vertical => image.height(),
        LongCaptureAxis::Horizontal => image.width(),
    };
    let cross_len = match axis {
        LongCaptureAxis::Vertical => image.width(),
        LongCaptureAxis::Horizontal => image.height(),
    };
    let window_size = AGGREGATE_SIGNATURE_WINDOW.min((axis_len / 2).max(1)).max(1);
    let cross_axis_offsets = aggregate_signature_cross_axis_offsets(image, axis);
    let mut lines = Vec::with_capacity(axis_len as usize);
    for index in 0..axis_len {
        lines.push(axis_line_signature(image, axis, index, &cross_axis_offsets));
    }

    let mut windows = Vec::new();
    let mut informative_positions = HashMap::<AxisWindowSignature, Vec<u32>>::new();
    if axis_len >= window_size {
        windows.reserve((axis_len - window_size + 1) as usize);
        for start in 0..=axis_len - window_size {
            let mut r = 0u64;
            let mut g = 0u64;
            let mut b = 0u64;
            let mut hash = 0xcbf2_9ce4_8422_2325u64;
            let mut texture = 0u64;
            let mut content = 0u32;
            for offset in 0..window_size {
                let line = lines[(start + offset) as usize];
                r += line.r;
                g += line.g;
                b += line.b;
                texture += line.texture;
                content += line.content;
                hash = signature_hash_mix(hash, line.hash ^ offset as u64);
            }
            windows.push(AxisWindowSignature {
                r,
                g,
                b,
                hash,
                texture,
                content,
            });
            let signature = *windows
                .last()
                .expect("signature was just appended to the windows list");
            if aggregate_window_signature_is_informative(&signature) {
                informative_positions
                    .entry(signature)
                    .or_default()
                    .push(start);
            }
        }
    }

    AxisSignatureList {
        axis_len,
        cross_len,
        window_size,
        windows,
        informative_positions,
    }
}

pub(crate) fn long_capture_motion_fingerprint(image: &RgbImage) -> LongCaptureMotionFingerprint {
    LongCaptureMotionFingerprint {
        width: image.width(),
        height: image.height(),
        vertical: axis_signature_list(image, LongCaptureAxis::Vertical),
        horizontal: axis_signature_list(image, LongCaptureAxis::Horizontal),
    }
}

fn motion_signature_candidate_for_direction(
    previous: &AxisSignatureList,
    current: &AxisSignatureList,
    axis: LongCaptureAxis,
    direction: LongCaptureDirection,
    max_scan: u32,
    min_overlap_px: u32,
    min_new_content_px: u32,
) -> Option<AggregateMatch> {
    if previous.cross_len != current.cross_len
        || previous.window_size != current.window_size
        || previous.windows.is_empty()
        || current.windows.is_empty()
        || !direction_matches_axis(direction, axis)
    {
        return None;
    }

    let current_informative_windows = current
        .windows
        .iter()
        .filter(|signature| aggregate_window_signature_is_informative(signature))
        .count() as u32;
    let previous_informative_windows = previous
        .windows
        .iter()
        .filter(|signature| aggregate_window_signature_is_informative(signature))
        .count() as u32;
    if current_informative_windows == 0 || previous_informative_windows == 0 {
        return None;
    }

    let previous_axis_len = previous.axis_len as i64;
    let current_axis_len = current.axis_len as i64;
    let max_new_px = max_scan.min(current.axis_len.saturating_sub(1)).max(1) as i64;
    let min_new_content_px = min_new_content_px.max(1) as i64;
    let min_overlap_px = min_overlap_px
        .min(current.axis_len.saturating_sub(1).max(1))
        .max(1) as i64;
    let max_overlap_px = previous_axis_len.min(current_axis_len);
    if max_overlap_px < min_overlap_px {
        return None;
    }

    let min_match_windows = (min_overlap_px / 3)
        .max(1)
        .min(24)
        .min(current_informative_windows.min(previous_informative_windows) as i64)
        .max(1) as u32;
    let mut best: Option<AggregateMatch> = None;

    for overlap_px in min_overlap_px..=max_overlap_px {
        let new_px = current_axis_len - overlap_px;
        if new_px < min_new_content_px || new_px > max_new_px {
            continue;
        }

        let (previous_window_start, current_window_start, prepend_px, append_px, origin) =
            match direction {
                LongCaptureDirection::Down | LongCaptureDirection::Right => {
                    (previous_axis_len - overlap_px, 0, 0, new_px, new_px)
                }
                LongCaptureDirection::Up | LongCaptureDirection::Left => {
                    (0, current_axis_len - overlap_px, new_px, 0, -new_px)
                }
            };

        let Some((match_windows, overlap_windows)) = aligned_signature_match_counts(
            previous,
            current,
            previous_window_start,
            current_window_start,
            overlap_px,
        ) else {
            continue;
        };
        let required_match_windows =
            aggregate_match_required_windows(min_match_windows, overlap_windows);
        if match_windows < required_match_windows {
            continue;
        }

        let candidate = AggregateMatch {
            origin,
            overlap_px,
            prepend_px,
            append_px,
            match_windows,
            overlap_windows,
        };
        if best
            .map(|current| aggregate_match_is_better(candidate, current))
            .unwrap_or(true)
        {
            best = Some(candidate);
        }
    }

    best
}

fn motion_signature_analysis_for_axis(
    previous: &AxisSignatureList,
    current: &AxisSignatureList,
    axis: LongCaptureAxis,
    options: LongCaptureAnalyzeOptions,
) -> Option<LongCaptureOverlapAnalysis> {
    let max_scan = options
        .max_scan
        .unwrap_or_else(|| current.axis_len.saturating_sub(1).max(1));
    let min_overlap_px = options
        .min_overlap_px
        .unwrap_or_else(|| default_min_overlap_px(current.axis_len, max_scan));
    let min_new_content_px = options.min_new_content_px.unwrap_or(1).max(1);
    let directions: Vec<LongCaptureDirection> = candidate_directions(Some(axis), options.direction)
        .into_iter()
        .filter(|direction| direction_matches_axis(*direction, axis))
        .collect();
    let mut best: Option<(LongCaptureDirection, AggregateMatch)> = None;

    for direction in directions {
        let Some(candidate) = motion_signature_candidate_for_direction(
            previous,
            current,
            axis,
            direction,
            max_scan,
            min_overlap_px,
            min_new_content_px,
        ) else {
            continue;
        };
        if best
            .map(|(_, current)| aggregate_match_is_better(candidate, current))
            .unwrap_or(true)
        {
            best = Some((direction, candidate));
        }
    }

    best.map(|(direction, candidate)| {
        let append_px = (candidate.prepend_px + candidate.append_px).max(0) as u32;
        let crop_start_px = match direction {
            LongCaptureDirection::Down | LongCaptureDirection::Right => candidate.overlap_px,
            LongCaptureDirection::Up | LongCaptureDirection::Left => append_px as i64,
        }
        .max(0) as u32;
        LongCaptureOverlapAnalysis {
            status: LongCaptureOverlapStatus::Good,
            axis: Some(axis),
            direction: Some(direction),
            overlap_px: candidate.overlap_px.max(0) as u32,
            crop_start_px,
            append_px,
            confidence: candidate.match_windows as f64 / candidate.overlap_windows.max(1) as f64,
            seam_px: crop_start_px,
        }
    })
}

pub(crate) fn analyze_long_capture_motion_fingerprints(
    previous: &LongCaptureMotionFingerprint,
    current: &LongCaptureMotionFingerprint,
    options: LongCaptureAnalyzeOptions,
) -> Option<LongCaptureOverlapAnalysis> {
    if previous.width != current.width || previous.height != current.height {
        return None;
    }

    let candidate_axes: &[LongCaptureAxis] = match options.axis {
        Some(LongCaptureAxis::Vertical) => &[LongCaptureAxis::Vertical],
        Some(LongCaptureAxis::Horizontal) => &[LongCaptureAxis::Horizontal],
        None => &[LongCaptureAxis::Vertical, LongCaptureAxis::Horizontal],
    };

    let mut best: Option<LongCaptureOverlapAnalysis> = None;
    for axis in candidate_axes {
        let analysis = match axis {
            LongCaptureAxis::Vertical => motion_signature_analysis_for_axis(
                &previous.vertical,
                &current.vertical,
                LongCaptureAxis::Vertical,
                options,
            ),
            LongCaptureAxis::Horizontal => motion_signature_analysis_for_axis(
                &previous.horizontal,
                &current.horizontal,
                LongCaptureAxis::Horizontal,
                options,
            ),
        };
        let Some(analysis) = analysis else {
            continue;
        };
        if options.axis.is_none() {
            let axis_len = match axis {
                LongCaptureAxis::Vertical => previous.height,
                LongCaptureAxis::Horizontal => previous.width,
            };
            if !analysis_confirms_axis(&analysis, axis_len) {
                continue;
            }
        }
        if best
            .map(|current| {
                let candidate = AggregateMatch {
                    origin: match analysis.direction {
                        Some(LongCaptureDirection::Down | LongCaptureDirection::Right) => {
                            analysis.append_px as i64
                        }
                        Some(LongCaptureDirection::Up | LongCaptureDirection::Left) => {
                            -(analysis.append_px as i64)
                        }
                        None => 0,
                    },
                    overlap_px: analysis.overlap_px as i64,
                    prepend_px: if matches!(
                        analysis.direction,
                        Some(LongCaptureDirection::Up | LongCaptureDirection::Left)
                    ) {
                        analysis.append_px as i64
                    } else {
                        0
                    },
                    append_px: if matches!(
                        analysis.direction,
                        Some(LongCaptureDirection::Down | LongCaptureDirection::Right)
                    ) {
                        analysis.append_px as i64
                    } else {
                        0
                    },
                    match_windows: (analysis.confidence * analysis.overlap_px.max(1) as f64).round()
                        as u32,
                    overlap_windows: analysis.overlap_px.max(1),
                };
                let current = AggregateMatch {
                    origin: match current.direction {
                        Some(LongCaptureDirection::Down | LongCaptureDirection::Right) => {
                            current.append_px as i64
                        }
                        Some(LongCaptureDirection::Up | LongCaptureDirection::Left) => {
                            -(current.append_px as i64)
                        }
                        None => 0,
                    },
                    overlap_px: current.overlap_px as i64,
                    prepend_px: if matches!(
                        current.direction,
                        Some(LongCaptureDirection::Up | LongCaptureDirection::Left)
                    ) {
                        current.append_px as i64
                    } else {
                        0
                    },
                    append_px: if matches!(
                        current.direction,
                        Some(LongCaptureDirection::Down | LongCaptureDirection::Right)
                    ) {
                        current.append_px as i64
                    } else {
                        0
                    },
                    match_windows: (current.confidence * current.overlap_px.max(1) as f64).round()
                        as u32,
                    overlap_windows: current.overlap_px.max(1),
                };
                aggregate_match_is_better(candidate, current)
            })
            .unwrap_or(true)
        {
            best = Some(analysis);
        }
    }

    best
}

fn aggregate_candidate_direction(
    axis: LongCaptureAxis,
    origin: i64,
) -> Option<LongCaptureDirection> {
    match axis {
        LongCaptureAxis::Vertical if origin > 0 => Some(LongCaptureDirection::Down),
        LongCaptureAxis::Vertical if origin < 0 => Some(LongCaptureDirection::Up),
        LongCaptureAxis::Horizontal if origin > 0 => Some(LongCaptureDirection::Right),
        LongCaptureAxis::Horizontal if origin < 0 => Some(LongCaptureDirection::Left),
        _ => None,
    }
}

fn direction_matches_axis(direction: LongCaptureDirection, axis: LongCaptureAxis) -> bool {
    direction_axis(direction) == axis
}

fn aggregate_direction_allowed(
    axis: LongCaptureAxis,
    origin: i64,
    requested: Option<LongCaptureDirection>,
) -> bool {
    let Some(requested) = requested else {
        return true;
    };
    if !direction_matches_axis(requested, axis) {
        return false;
    }
    aggregate_candidate_direction(axis, origin)
        .map(|candidate| candidate == requested)
        .unwrap_or(false)
}

fn aggregate_match_is_better(candidate: AggregateMatch, current: AggregateMatch) -> bool {
    let candidate_new = candidate.prepend_px + candidate.append_px;
    let current_new = current.prepend_px + current.append_px;
    let candidate_density = candidate.match_windows as u64 * current.overlap_windows.max(1) as u64;
    let current_density = current.match_windows as u64 * candidate.overlap_windows.max(1) as u64;

    candidate_density > current_density
        || (candidate_density == current_density && candidate.match_windows > current.match_windows)
        || (candidate_density == current_density
            && candidate.match_windows == current.match_windows
            && candidate.overlap_px > current.overlap_px)
        || (candidate_density == current_density
            && candidate.match_windows == current.match_windows
            && candidate.overlap_px == current.overlap_px
            && candidate_new < current_new)
        || (candidate_density == current_density
            && candidate.match_windows == current.match_windows
            && candidate.overlap_px == current.overlap_px
            && candidate_new == current_new
            && candidate.origin.abs() < current.origin.abs())
}

fn aligned_signature_match_counts(
    aggregate_signatures: &AxisSignatureList,
    current_signatures: &AxisSignatureList,
    aggregate_window_start: i64,
    current_window_start: i64,
    overlap_px: i64,
) -> Option<(u32, u32)> {
    let window_size = aggregate_signatures.window_size as i64;
    if overlap_px < window_size
        || aggregate_signatures.window_size != current_signatures.window_size
    {
        return None;
    }

    let overlap_windows = overlap_px - window_size + 1;
    let mut match_windows = 0u32;
    let mut informative_windows = 0u32;
    for offset in 0..overlap_windows {
        let aggregate_index = aggregate_window_start + offset;
        let current_index = current_window_start + offset;
        if aggregate_index < 0
            || current_index < 0
            || aggregate_index as usize >= aggregate_signatures.windows.len()
            || current_index as usize >= current_signatures.windows.len()
        {
            return None;
        }

        let aggregate_signature = aggregate_signatures.windows[aggregate_index as usize];
        let current_signature = current_signatures.windows[current_index as usize];
        if !aggregate_window_signature_is_informative(&aggregate_signature)
            && !aggregate_window_signature_is_informative(&current_signature)
        {
            continue;
        }

        informative_windows += 1;
        if aggregate_signature == current_signature {
            match_windows += 1;
        }
    }

    if informative_windows == 0 {
        None
    } else {
        Some((match_windows, informative_windows))
    }
}

fn aggregate_signature_cross_axis_offset_count(cross_len: u32) -> u64 {
    let edge_ignore = if cross_len >= 160 {
        default_edge_ignore(cross_len).max(24).min(cross_len / 4)
    } else {
        default_edge_ignore(cross_len)
    };
    let offsets = sampled_cross_axis_offsets(cross_len, edge_ignore);
    if offsets.is_empty() {
        sampled_cross_axis_offsets(cross_len, 0).len() as u64
    } else {
        offsets.len() as u64
    }
}

fn axis_window_signature_fuzzy_matches(
    left: AxisWindowSignature,
    right: AxisWindowSignature,
    sample_count: u64,
    window_size: u32,
) -> bool {
    if left == right {
        return true;
    }
    if !aggregate_window_signature_is_informative(&left)
        && !aggregate_window_signature_is_informative(&right)
    {
        return false;
    }

    let sample_window = sample_count
        .saturating_mul(window_size.max(1) as u64)
        .max(1);
    let color_tolerance = sample_window.saturating_mul(8);
    let texture_tolerance = sample_window.saturating_mul(20);
    let content_tolerance = ((sample_window as f64) * 0.10).ceil().max(2.0) as u32;

    left.r.abs_diff(right.r) <= color_tolerance
        && left.g.abs_diff(right.g) <= color_tolerance
        && left.b.abs_diff(right.b) <= color_tolerance
        && left.texture.abs_diff(right.texture) <= texture_tolerance
        && left.content.abs_diff(right.content) <= content_tolerance
}

fn aligned_signature_fuzzy_match_counts(
    aggregate_signatures: &AxisSignatureList,
    current_signatures: &AxisSignatureList,
    aggregate_window_start: i64,
    current_window_start: i64,
    overlap_px: i64,
) -> Option<(u32, u32)> {
    let window_size = aggregate_signatures.window_size as i64;
    if overlap_px < window_size
        || aggregate_signatures.window_size != current_signatures.window_size
        || aggregate_signatures.cross_len != current_signatures.cross_len
    {
        return None;
    }

    let sample_count = aggregate_signature_cross_axis_offset_count(aggregate_signatures.cross_len);
    let overlap_windows = overlap_px - window_size + 1;
    let mut match_windows = 0u32;
    let mut informative_windows = 0u32;
    for offset in 0..overlap_windows {
        let aggregate_index = aggregate_window_start + offset;
        let current_index = current_window_start + offset;
        if aggregate_index < 0
            || current_index < 0
            || aggregate_index as usize >= aggregate_signatures.windows.len()
            || current_index as usize >= current_signatures.windows.len()
        {
            return None;
        }

        let aggregate_signature = aggregate_signatures.windows[aggregate_index as usize];
        let current_signature = current_signatures.windows[current_index as usize];
        if !aggregate_window_signature_is_informative(&aggregate_signature)
            && !aggregate_window_signature_is_informative(&current_signature)
        {
            continue;
        }

        informative_windows += 1;
        if axis_window_signature_fuzzy_matches(
            aggregate_signature,
            current_signature,
            sample_count,
            aggregate_signatures.window_size,
        ) {
            match_windows += 1;
        }
    }

    if informative_windows == 0 {
        None
    } else {
        Some((match_windows, informative_windows))
    }
}

fn aggregate_match_required_windows(min_match_windows: u32, overlap_windows: u32) -> u32 {
    min_match_windows.max(((overlap_windows as f64) * 0.65).ceil().max(1.0) as u32)
}

fn aggregate_fuzzy_match_required_windows(min_match_windows: u32, overlap_windows: u32) -> u32 {
    min_match_windows.max(((overlap_windows as f64) * 0.88).ceil().max(1.0) as u32)
}

fn aggregate_frame_is_already_covered(
    aggregate_signatures: &AxisSignatureList,
    current_signatures: &AxisSignatureList,
    frame_len: i64,
    min_match_windows: u32,
) -> bool {
    if frame_len <= 0 || frame_len > aggregate_signatures.axis_len as i64 {
        return false;
    }
    if current_signatures.windows.is_empty()
        || aggregate_signatures.informative_positions.is_empty()
    {
        return false;
    }

    let mut anchors = current_signatures
        .windows
        .iter()
        .enumerate()
        .filter_map(|(current_position, signature)| {
            if !aggregate_window_signature_is_informative(signature) {
                return None;
            }
            let positions = aggregate_signatures.informative_positions.get(signature)?;
            Some((positions.len(), current_position as i64, *signature))
        })
        .collect::<Vec<_>>();
    anchors.sort_by_key(|(position_count, _, _)| *position_count);

    let mut origin_votes = HashMap::<i64, u32>::new();
    for (_, current_position, signature) in anchors.into_iter().take(12) {
        let Some(aggregate_positions) = aggregate_signatures.informative_positions.get(&signature)
        else {
            continue;
        };
        for &aggregate_position in aggregate_positions {
            let origin_delta = aggregate_position as i64 - current_position;
            if origin_delta >= 0 && origin_delta + frame_len <= aggregate_signatures.axis_len as i64
            {
                *origin_votes.entry(origin_delta).or_insert(0) += 1;
            }
        }
    }

    let mut origins = origin_votes.into_iter().collect::<Vec<_>>();
    origins.sort_by(|(left_origin, left_votes), (right_origin, right_votes)| {
        right_votes
            .cmp(left_votes)
            .then_with(|| left_origin.abs().cmp(&right_origin.abs()))
    });

    origins.into_iter().take(64).any(|(origin_delta, _)| {
        let Some((match_windows, overlap_windows)) = aligned_signature_match_counts(
            aggregate_signatures,
            current_signatures,
            origin_delta,
            0,
            frame_len,
        ) else {
            return false;
        };
        let required =
            min_match_windows.max(((overlap_windows as f64) * 0.85).ceil().max(1.0) as u32);
        match_windows >= required
    })
}

fn aggregate_candidate_new_slice_is_already_covered(
    aggregate_signatures: &AxisSignatureList,
    current_signatures: &AxisSignatureList,
    matched: AggregateMatch,
) -> bool {
    if aggregate_signatures.window_size != current_signatures.window_size
        || aggregate_signatures.cross_len != current_signatures.cross_len
        || aggregate_signatures.informative_positions.is_empty()
    {
        return false;
    }

    let frame_len = current_signatures.axis_len as i64;
    let window_size = current_signatures.window_size as i64;
    let (new_start, new_len) = if matched.append_px > 0 && matched.prepend_px == 0 {
        (frame_len - matched.append_px, matched.append_px)
    } else if matched.prepend_px > 0 && matched.append_px == 0 {
        (0, matched.prepend_px)
    } else {
        return false;
    };
    if new_start < 0 || new_len < window_size.max(16) {
        return false;
    }

    let new_window_end = new_start + new_len - window_size + 1;
    if new_window_end <= new_start || new_window_end as usize > current_signatures.windows.len() {
        return false;
    }

    let mut anchors = current_signatures.windows[new_start as usize..new_window_end as usize]
        .iter()
        .enumerate()
        .filter_map(|(offset, signature)| {
            if !aggregate_window_signature_is_informative(signature) {
                return None;
            }
            let positions = aggregate_signatures.informative_positions.get(signature)?;
            Some((positions.len(), new_start + offset as i64, *signature))
        })
        .collect::<Vec<_>>();
    if anchors.len() < 4 {
        return false;
    }
    anchors.sort_by_key(|(position_count, _, _)| *position_count);

    let mut origin_votes = HashMap::<i64, u32>::new();
    for (_, current_position, signature) in anchors.into_iter().take(24) {
        let Some(aggregate_positions) = aggregate_signatures.informative_positions.get(&signature)
        else {
            continue;
        };
        for &aggregate_position in aggregate_positions {
            let origin_delta = aggregate_position as i64 - current_position;
            let aggregate_new_start = origin_delta + new_start;
            if aggregate_new_start >= 0
                && aggregate_new_start + new_len <= aggregate_signatures.axis_len as i64
            {
                *origin_votes.entry(origin_delta).or_insert(0) += 1;
            }
        }
    }

    let mut origins = origin_votes.into_iter().collect::<Vec<_>>();
    origins.sort_by(|(left_origin, left_votes), (right_origin, right_votes)| {
        right_votes
            .cmp(left_votes)
            .then_with(|| left_origin.abs().cmp(&right_origin.abs()))
    });

    origins.into_iter().take(64).any(|(origin_delta, _)| {
        let aggregate_new_start = origin_delta + new_start;
        let Some((match_windows, overlap_windows)) = aligned_signature_match_counts(
            aggregate_signatures,
            current_signatures,
            aggregate_new_start,
            new_start,
            new_len,
        ) else {
            return false;
        };
        let required = ((overlap_windows as f64) * 0.92).ceil().max(4.0) as u32;
        match_windows >= required
    })
}

fn rebuild_informative_positions(
    windows: &[AxisWindowSignature],
) -> HashMap<AxisWindowSignature, Vec<u32>> {
    let mut informative_positions = HashMap::<AxisWindowSignature, Vec<u32>>::new();
    for (position, signature) in windows.iter().enumerate() {
        if aggregate_window_signature_is_informative(signature) {
            informative_positions
                .entry(*signature)
                .or_default()
                .push(position as u32);
        }
    }
    informative_positions
}

fn axis_signature_list_from_windows(
    axis_len: u32,
    cross_len: u32,
    window_size: u32,
    windows: Vec<AxisWindowSignature>,
) -> AxisSignatureList {
    let informative_positions = rebuild_informative_positions(&windows);
    AxisSignatureList {
        axis_len,
        cross_len,
        window_size,
        windows,
        informative_positions,
    }
}

fn merge_axis_signature_lists(
    aggregate_signatures: &AxisSignatureList,
    current_signatures: &AxisSignatureList,
    matched: AggregateMatch,
) -> Option<AxisSignatureList> {
    if aggregate_signatures.window_size != current_signatures.window_size
        || aggregate_signatures.cross_len != current_signatures.cross_len
    {
        return None;
    }

    let new_axis_len =
        (aggregate_signatures.axis_len as i64 + matched.prepend_px + matched.append_px) as u32;
    let mut windows = Vec::new();
    if matched.prepend_px > 0 {
        let prepend_count = matched.prepend_px as usize;
        if prepend_count > current_signatures.windows.len() {
            return None;
        }
        windows.reserve(current_signatures.windows.len() + aggregate_signatures.windows.len());
        windows.extend_from_slice(&current_signatures.windows[..prepend_count]);
        windows.extend_from_slice(&aggregate_signatures.windows);
    } else if matched.append_px > 0 {
        let append_count = matched.append_px as usize;
        if append_count > current_signatures.windows.len() {
            return None;
        }
        let append_start = current_signatures.windows.len() - append_count;
        windows.reserve(aggregate_signatures.windows.len() + append_count);
        windows.extend_from_slice(&aggregate_signatures.windows);
        windows.extend_from_slice(&current_signatures.windows[append_start..]);
    } else {
        windows.extend_from_slice(&aggregate_signatures.windows);
    }

    Some(axis_signature_list_from_windows(
        new_axis_len,
        aggregate_signatures.cross_len,
        aggregate_signatures.window_size,
        windows,
    ))
}

fn aggregate_boundary_fuzzy_match_confirms(
    aggregate: &LongCaptureAggregate,
    current: &RgbImage,
    axis: LongCaptureAxis,
    direction: LongCaptureDirection,
    overlap_px: u32,
) -> bool {
    let boundary = match crop_aggregate_boundary(aggregate, axis, direction, overlap_px) {
        Some(boundary) => boundary,
        None => return false,
    };

    match direction {
        LongCaptureDirection::Down if axis == LongCaptureAxis::Vertical => {
            if boundary.width() != current.width()
                || overlap_px == 0
                || overlap_px > current.height()
            {
                return false;
            }
            let edge_ignore = default_edge_ignore(current.width());
            let offsets = sampled_cross_axis_offsets(current.width(), edge_ignore);
            let weights = vec![1.0; current.width() as usize];
            let (ratio, mean_diff, texture_score, content_ratio) =
                vertical_overlap_score(&boundary, current, 0, 0, overlap_px, &weights, &offsets);
            score_confidence(ratio, mean_diff) >= 0.65
                && (texture_score >= 12.0 || content_ratio >= 0.01)
        }
        LongCaptureDirection::Up if axis == LongCaptureAxis::Vertical => {
            if boundary.width() != current.width()
                || overlap_px == 0
                || overlap_px > current.height()
            {
                return false;
            }
            let edge_ignore = default_edge_ignore(current.width());
            let offsets = sampled_cross_axis_offsets(current.width(), edge_ignore);
            let weights = vec![1.0; current.width() as usize];
            let curr_start = current.height() - overlap_px;
            let (ratio, mean_diff, texture_score, content_ratio) = vertical_overlap_score(
                &boundary, current, 0, curr_start, overlap_px, &weights, &offsets,
            );
            score_confidence(ratio, mean_diff) >= 0.65
                && (texture_score >= 12.0 || content_ratio >= 0.01)
        }
        LongCaptureDirection::Right if axis == LongCaptureAxis::Horizontal => {
            if boundary.height() != current.height()
                || overlap_px == 0
                || overlap_px > current.width()
            {
                return false;
            }
            let edge_ignore = default_edge_ignore(current.height());
            let offsets = sampled_cross_axis_offsets(current.height(), edge_ignore);
            let weights = vec![1.0; current.height() as usize];
            let (ratio, mean_diff, texture_score, content_ratio) =
                horizontal_overlap_score(&boundary, current, 0, 0, overlap_px, &weights, &offsets);
            score_confidence(ratio, mean_diff) >= 0.65
                && (texture_score >= 12.0 || content_ratio >= 0.01)
        }
        LongCaptureDirection::Left if axis == LongCaptureAxis::Horizontal => {
            if boundary.height() != current.height()
                || overlap_px == 0
                || overlap_px > current.width()
            {
                return false;
            }
            let edge_ignore = default_edge_ignore(current.height());
            let offsets = sampled_cross_axis_offsets(current.height(), edge_ignore);
            let weights = vec![1.0; current.height() as usize];
            let curr_start = current.width() - overlap_px;
            let (ratio, mean_diff, texture_score, content_ratio) = horizontal_overlap_score(
                &boundary, current, 0, curr_start, overlap_px, &weights, &offsets,
            );
            score_confidence(ratio, mean_diff) >= 0.65
                && (texture_score >= 12.0 || content_ratio >= 0.01)
        }
        _ => false,
    }
}

fn aggregate_match_from_adjacent_signatures(
    aggregate: &LongCaptureAggregate,
    previous_signatures: &AxisSignatureList,
    current: &RgbImage,
    axis: LongCaptureAxis,
    options: LongCaptureStitchOptions,
) -> Option<AggregateMatchCandidate> {
    let aggregate_signatures = aggregate.signatures.as_ref()?;
    let current_signatures = axis_signature_list(current, axis);
    if aggregate_signatures.cross_len != current_signatures.cross_len
        || aggregate_signatures.window_size != current_signatures.window_size
        || previous_signatures.cross_len != current_signatures.cross_len
        || previous_signatures.window_size != current_signatures.window_size
        || current_signatures.windows.is_empty()
        || previous_signatures.windows.is_empty()
    {
        return None;
    }

    let current_informative_windows = current_signatures
        .windows
        .iter()
        .filter(|signature| aggregate_window_signature_is_informative(signature))
        .count() as u32;
    if current_informative_windows == 0 {
        return None;
    }

    let previous_axis_len = previous_signatures.axis_len as i64;
    let aggregate_axis_len = aggregate_axis_len(aggregate, axis) as i64;
    let frame_len = current_signatures.axis_len as i64;
    let min_overlap_px = options.min_overlap_px.unwrap_or_else(|| {
        default_min_overlap_px(
            current_signatures.axis_len,
            options
                .max_scan
                .unwrap_or_else(|| current_signatures.axis_len.saturating_sub(1).max(1)),
        )
    }) as i64;
    let max_new_px = options
        .max_scan
        .unwrap_or_else(|| current_signatures.axis_len.saturating_sub(1).max(1))
        as i64;
    let max_overlap_px = previous_axis_len.min(frame_len);
    if max_overlap_px < min_overlap_px {
        return None;
    }
    let min_match_windows = (min_overlap_px / 3)
        .max(1)
        .min(24)
        .min(current_informative_windows as i64)
        .max(1) as u32;

    let mut best: Option<AggregateMatch> = None;
    for overlap_px in min_overlap_px..=max_overlap_px {
        let new_px = frame_len - overlap_px;
        if new_px <= 0 || new_px > max_new_px {
            continue;
        }

        let direction = match axis {
            LongCaptureAxis::Vertical => LongCaptureDirection::Down,
            LongCaptureAxis::Horizontal => LongCaptureDirection::Right,
        };
        if aggregate_direction_allowed(axis, aggregate_axis_len - overlap_px, options.direction) {
            if let Some((match_windows, overlap_windows)) = aligned_signature_match_counts(
                previous_signatures,
                &current_signatures,
                previous_axis_len - overlap_px,
                0,
                overlap_px,
            ) {
                let required_match_windows =
                    aggregate_match_required_windows(min_match_windows, overlap_windows);
                if match_windows >= required_match_windows
                    && aggregate_boundary_fuzzy_match_confirms(
                        aggregate,
                        current,
                        axis,
                        direction,
                        overlap_px as u32,
                    )
                {
                    let candidate = AggregateMatch {
                        origin: aggregate.origin + aggregate_axis_len - overlap_px,
                        overlap_px,
                        prepend_px: 0,
                        append_px: new_px,
                        match_windows,
                        overlap_windows,
                    };
                    if best
                        .map(|current| aggregate_match_is_better(candidate, current))
                        .unwrap_or(true)
                    {
                        best = Some(candidate);
                    }
                }
            }
        }

        let direction = match axis {
            LongCaptureAxis::Vertical => LongCaptureDirection::Up,
            LongCaptureAxis::Horizontal => LongCaptureDirection::Left,
        };
        if aggregate_direction_allowed(axis, -new_px, options.direction) {
            if let Some((match_windows, overlap_windows)) = aligned_signature_match_counts(
                previous_signatures,
                &current_signatures,
                0,
                frame_len - overlap_px,
                overlap_px,
            ) {
                let required_match_windows =
                    aggregate_match_required_windows(min_match_windows, overlap_windows);
                if match_windows >= required_match_windows
                    && aggregate_boundary_fuzzy_match_confirms(
                        aggregate,
                        current,
                        axis,
                        direction,
                        overlap_px as u32,
                    )
                {
                    let candidate = AggregateMatch {
                        origin: aggregate.origin - new_px,
                        overlap_px,
                        prepend_px: new_px,
                        append_px: 0,
                        match_windows,
                        overlap_windows,
                    };
                    if best
                        .map(|current| aggregate_match_is_better(candidate, current))
                        .unwrap_or(true)
                    {
                        best = Some(candidate);
                    }
                }
            }
        }
    }

    best.map(|matched| AggregateMatchCandidate {
        matched,
        current_signatures,
    })
}

fn aggregate_match_direction(
    matched: AggregateMatch,
    axis: LongCaptureAxis,
) -> Option<LongCaptureDirection> {
    match axis {
        LongCaptureAxis::Vertical if matched.append_px > 0 && matched.prepend_px == 0 => {
            Some(LongCaptureDirection::Down)
        }
        LongCaptureAxis::Vertical if matched.prepend_px > 0 && matched.append_px == 0 => {
            Some(LongCaptureDirection::Up)
        }
        LongCaptureAxis::Horizontal if matched.append_px > 0 && matched.prepend_px == 0 => {
            Some(LongCaptureDirection::Right)
        }
        LongCaptureAxis::Horizontal if matched.prepend_px > 0 && matched.append_px == 0 => {
            Some(LongCaptureDirection::Left)
        }
        _ => None,
    }
}

fn choose_aggregate_match_candidate(
    exact: Option<AggregateMatchCandidate>,
    directed: Option<AggregateMatchCandidate>,
    axis: LongCaptureAxis,
) -> Option<AggregateMatchCandidate> {
    match (exact, directed) {
        (Some(exact), Some(directed)) => {
            let exact_direction = aggregate_match_direction(exact.matched, axis);
            let directed_direction = aggregate_match_direction(directed.matched, axis);
            if exact_direction.is_some()
                && directed_direction.is_some()
                && exact_direction != directed_direction
            {
                return Some(directed);
            }
            if aggregate_match_is_better(directed.matched, exact.matched) {
                Some(directed)
            } else {
                Some(exact)
            }
        }
        (Some(exact), None) => Some(exact),
        (None, Some(directed)) => Some(directed),
        (None, None) => None,
    }
}

fn aggregate_contains_current_frame(
    aggregate: &LongCaptureAggregate,
    current: &RgbImage,
    axis: LongCaptureAxis,
    options: LongCaptureStitchOptions,
) -> bool {
    let Some(aggregate_signatures) = aggregate.signatures.as_ref() else {
        return false;
    };
    if aggregate_signatures.cross_len
        != match axis {
            LongCaptureAxis::Vertical => current.width(),
            LongCaptureAxis::Horizontal => current.height(),
        }
    {
        return false;
    }

    let current_signatures = axis_signature_list(current, axis);
    if aggregate_signatures.window_size != current_signatures.window_size
        || aggregate_signatures.windows.is_empty()
        || current_signatures.windows.is_empty()
    {
        return false;
    }

    let current_informative_windows = current_signatures
        .windows
        .iter()
        .filter(|signature| aggregate_window_signature_is_informative(signature))
        .count() as u32;
    if current_informative_windows == 0 {
        return false;
    }

    let min_overlap_px = options.min_overlap_px.unwrap_or_else(|| {
        default_min_overlap_px(
            current_signatures.axis_len,
            options
                .max_scan
                .unwrap_or_else(|| current_signatures.axis_len.saturating_sub(1).max(1)),
        )
    }) as i64;
    let min_match_windows = (min_overlap_px / 3)
        .max(1)
        .min(24)
        .min(current_informative_windows as i64)
        .max(1) as u32;

    aggregate_frame_is_already_covered(
        aggregate_signatures,
        &current_signatures,
        current_signatures.axis_len as i64,
        min_match_windows,
    )
}

fn find_aggregate_signature_match(
    aggregate: &LongCaptureAggregate,
    current: &RgbImage,
    axis: LongCaptureAxis,
    options: LongCaptureStitchOptions,
) -> Option<AggregateMatchCandidate> {
    let aggregate_signatures = aggregate.signatures.as_ref()?;
    if aggregate_signatures.cross_len
        != match axis {
            LongCaptureAxis::Vertical => current.width(),
            LongCaptureAxis::Horizontal => current.height(),
        }
    {
        return None;
    }

    let current_signatures = axis_signature_list(current, axis);
    if aggregate_signatures.window_size != current_signatures.window_size
        || aggregate_signatures.windows.is_empty()
        || current_signatures.windows.is_empty()
    {
        return None;
    }

    if aggregate_signatures.informative_positions.is_empty() {
        return None;
    }

    let mut current_informative_windows = 0u32;
    for signature in &current_signatures.windows {
        if aggregate_window_signature_is_informative(signature) {
            current_informative_windows += 1;
        }
    }
    if current_informative_windows == 0 {
        return None;
    }

    let aggregate_axis_len = aggregate_signatures.axis_len as i64;
    let frame_len = current_signatures.axis_len as i64;
    let min_overlap_px = options.min_overlap_px.unwrap_or_else(|| {
        default_min_overlap_px(
            current_signatures.axis_len,
            options
                .max_scan
                .unwrap_or_else(|| current_signatures.axis_len.saturating_sub(1).max(1)),
        )
    }) as i64;
    let min_match_windows = (min_overlap_px / 3)
        .max(1)
        .min(24)
        .min(current_informative_windows as i64)
        .max(1) as u32;

    if aggregate_frame_is_already_covered(
        aggregate_signatures,
        &current_signatures,
        frame_len,
        min_match_windows,
    ) {
        return None;
    }

    let max_overlap_px = aggregate_axis_len.min(frame_len);
    if max_overlap_px < min_overlap_px {
        return None;
    }
    let max_new_px = options
        .max_scan
        .unwrap_or_else(|| current_signatures.axis_len.saturating_sub(1).max(1))
        as i64;

    let mut best: Option<AggregateMatch> = None;
    for overlap_px in min_overlap_px..=max_overlap_px {
        let append_px = frame_len - overlap_px;
        if append_px > 0 && append_px <= max_new_px {
            let origin = aggregate.origin + aggregate_axis_len - overlap_px;
            if aggregate_direction_allowed(axis, origin - aggregate.origin, options.direction) {
                let mut accepted_counts = None;
                if let Some((match_windows, overlap_windows)) = aligned_signature_match_counts(
                    aggregate_signatures,
                    &current_signatures,
                    aggregate_axis_len - overlap_px,
                    0,
                    overlap_px,
                ) {
                    let required_match_windows =
                        aggregate_match_required_windows(min_match_windows, overlap_windows);
                    if match_windows >= required_match_windows {
                        accepted_counts = Some((match_windows, overlap_windows));
                    }
                }
                if accepted_counts.is_none() {
                    if let Some((match_windows, overlap_windows)) =
                        aligned_signature_fuzzy_match_counts(
                            aggregate_signatures,
                            &current_signatures,
                            aggregate_axis_len - overlap_px,
                            0,
                            overlap_px,
                        )
                    {
                        let required_match_windows = aggregate_fuzzy_match_required_windows(
                            min_match_windows,
                            overlap_windows,
                        );
                        let direction = match axis {
                            LongCaptureAxis::Vertical => LongCaptureDirection::Down,
                            LongCaptureAxis::Horizontal => LongCaptureDirection::Right,
                        };
                        if match_windows >= required_match_windows
                            && aggregate_boundary_fuzzy_match_confirms(
                                aggregate,
                                current,
                                axis,
                                direction,
                                overlap_px as u32,
                            )
                        {
                            accepted_counts = Some((match_windows, overlap_windows));
                        }
                    }
                }
                if let Some((match_windows, overlap_windows)) = accepted_counts {
                    let candidate = AggregateMatch {
                        origin,
                        overlap_px,
                        prepend_px: 0,
                        append_px,
                        match_windows,
                        overlap_windows,
                    };
                    if best
                        .map(|current| aggregate_match_is_better(candidate, current))
                        .unwrap_or(true)
                    {
                        best = Some(candidate);
                    }
                }
            }
        }

        let prepend_px = frame_len - overlap_px;
        if prepend_px > 0 && prepend_px <= max_new_px {
            let origin = aggregate.origin - prepend_px;
            if aggregate_direction_allowed(axis, origin - aggregate.origin, options.direction) {
                let mut accepted_counts = None;
                if let Some((match_windows, overlap_windows)) = aligned_signature_match_counts(
                    aggregate_signatures,
                    &current_signatures,
                    0,
                    frame_len - overlap_px,
                    overlap_px,
                ) {
                    let required_match_windows =
                        aggregate_match_required_windows(min_match_windows, overlap_windows);
                    if match_windows >= required_match_windows {
                        accepted_counts = Some((match_windows, overlap_windows));
                    }
                }
                if accepted_counts.is_none() {
                    if let Some((match_windows, overlap_windows)) =
                        aligned_signature_fuzzy_match_counts(
                            aggregate_signatures,
                            &current_signatures,
                            0,
                            frame_len - overlap_px,
                            overlap_px,
                        )
                    {
                        let required_match_windows = aggregate_fuzzy_match_required_windows(
                            min_match_windows,
                            overlap_windows,
                        );
                        let direction = match axis {
                            LongCaptureAxis::Vertical => LongCaptureDirection::Up,
                            LongCaptureAxis::Horizontal => LongCaptureDirection::Left,
                        };
                        if match_windows >= required_match_windows
                            && aggregate_boundary_fuzzy_match_confirms(
                                aggregate,
                                current,
                                axis,
                                direction,
                                overlap_px as u32,
                            )
                        {
                            accepted_counts = Some((match_windows, overlap_windows));
                        }
                    }
                }
                if let Some((match_windows, overlap_windows)) = accepted_counts {
                    let candidate = AggregateMatch {
                        origin,
                        overlap_px,
                        prepend_px,
                        append_px: 0,
                        match_windows,
                        overlap_windows,
                    };
                    if best
                        .map(|current| aggregate_match_is_better(candidate, current))
                        .unwrap_or(true)
                    {
                        best = Some(candidate);
                    }
                }
            }
        }
    }

    best.map(|matched| AggregateMatchCandidate {
        matched,
        current_signatures,
    })
}

fn aggregate_crop_axis_segment(
    image: &RgbImage,
    axis: LongCaptureAxis,
    start: i64,
    len: i64,
) -> Result<RgbImage> {
    crop_axis_segment(image, axis, start, len)
}

fn merge_frame_into_aggregate(
    aggregate: &mut LongCaptureAggregate,
    current: &RgbImage,
    axis: LongCaptureAxis,
    candidate: AggregateMatchCandidate,
) -> Result<()> {
    let matched = candidate.matched;
    let previous_signatures = aggregate.signatures.take();
    if matched.prepend_px > 0 {
        let crop = aggregate_crop_axis_segment(current, axis, 0, matched.prepend_px)?;
        push_aggregate_segment(aggregate, crop, axis, true)?;
        aggregate.origin -= matched.prepend_px;
    }

    if matched.append_px > 0 {
        let current_axis_len = frame_axis_len(current, axis);
        let crop_start = current_axis_len - matched.append_px;
        let crop = aggregate_crop_axis_segment(current, axis, crop_start, matched.append_px)?;
        push_aggregate_segment(aggregate, crop, axis, false)?;
    }

    aggregate.signatures = previous_signatures
        .as_ref()
        .and_then(|signatures| {
            merge_axis_signature_lists(signatures, &candidate.current_signatures, matched)
        })
        .or_else(|| {
            let aggregate_image = aggregate_to_image(aggregate, axis);
            Some(axis_signature_list(&aggregate_image, axis))
        });
    Ok(())
}

fn aggregate_axes_to_try(axis: Option<LongCaptureAxis>) -> &'static [LongCaptureAxis] {
    match axis {
        Some(LongCaptureAxis::Vertical) => &[LongCaptureAxis::Vertical],
        Some(LongCaptureAxis::Horizontal) => &[LongCaptureAxis::Horizontal],
        None => &[LongCaptureAxis::Vertical, LongCaptureAxis::Horizontal],
    }
}

fn infer_axis_from_adjacent_frames(
    frames: &[RgbImage],
    options: LongCaptureStitchOptions,
) -> Option<LongCaptureAxis> {
    if let Some(axis) = options.axis {
        return Some(axis);
    }

    let mut vertical_score = 0.0f64;
    let mut horizontal_score = 0.0f64;
    let mut inspected_pairs = 0usize;

    for pair in frames.windows(2) {
        if inspected_pairs >= 8 {
            break;
        }
        inspected_pairs += 1;

        let analysis = analyze_long_capture_pair_images(
            &pair[0],
            &pair[1],
            LongCaptureAnalyzeOptions {
                axis: None,
                direction: None,
                max_scan: options.max_scan,
                min_overlap_px: options.min_overlap_px,
                min_new_content_px: Some(2),
            },
        );

        if !matches!(
            analysis.status,
            LongCaptureOverlapStatus::Good | LongCaptureOverlapStatus::TooSmallMotion
        ) {
            continue;
        }

        let weight = 1.0 + analysis.confidence + (analysis.append_px as f64 / 24.0).min(1.0);
        match analysis.axis {
            Some(LongCaptureAxis::Vertical) => vertical_score += weight,
            Some(LongCaptureAxis::Horizontal) => horizontal_score += weight,
            None => {}
        }

        if vertical_score > 0.0 && vertical_score >= horizontal_score {
            return Some(LongCaptureAxis::Vertical);
        }
    }

    if vertical_score > 0.0 && vertical_score >= horizontal_score {
        Some(LongCaptureAxis::Vertical)
    } else if horizontal_score > 0.0 && horizontal_score > vertical_score * 1.25 {
        Some(LongCaptureAxis::Horizontal)
    } else {
        None
    }
}

impl LongCaptureIncrementalStitcher {
    fn new_with_axis(
        first_frame: RgbImage,
        options: LongCaptureStitchOptions,
        axis: Option<LongCaptureAxis>,
    ) -> Self {
        let signatures = axis.map(|axis| axis_signature_list(&first_frame, axis));
        let mut segments = VecDeque::new();
        segments.push_back(first_frame.clone());
        let last_direction_reference_signatures = axis.and_then(|axis| {
            signatures
                .clone()
                .map(|signatures| (axis, signatures, DirectionReferenceSource::Merged))
        });
        Self {
            options,
            aggregate: LongCaptureAggregate {
                axis,
                origin: 0,
                segments,
                signatures,
            },
            frame_count: 1,
            merged_frames: 1,
            skipped_frames: 0,
            adjacent_fast_path_merges: 0,
            aggregate_signature_searches: 0,
            expensive_adjacent_pair_analyses: 0,
            last_direction_reference_signatures,
        }
    }

    pub fn new(first_frame: RgbImage, options: LongCaptureStitchOptions) -> Self {
        Self::new_with_axis(first_frame, options, options.axis)
    }

    pub fn push_frame(&mut self, current: &RgbImage) -> Result<bool> {
        self.push_frame_owned(current.clone())
    }

    pub fn push_frame_owned(&mut self, current: RgbImage) -> Result<bool> {
        let frame_index = self.frame_count;
        self.frame_count += 1;

        let mut best: Option<(LongCaptureAxis, AggregateMatchCandidate)> = None;
        for &axis in aggregate_axes_to_try(self.aggregate.axis) {
            if self.aggregate.axis.is_none() {
                let aggregate_image = aggregate_to_image(&self.aggregate, axis);
                self.aggregate.signatures = Some(axis_signature_list(&aggregate_image, axis));
            }
            let mut rejected_covered_skip_fast_path = false;
            let lightweight_directed_candidate = self
                .last_direction_reference_signatures
                .as_ref()
                .and_then(|(signature_axis, previous_signatures, source)| {
                    if *signature_axis != axis {
                        return None;
                    }
                    let candidate = aggregate_match_from_adjacent_signatures(
                        &self.aggregate,
                        previous_signatures,
                        &current,
                        axis,
                        self.options,
                    )?;
                    if *source == DirectionReferenceSource::CoveredSkip {
                        let Some(aggregate_signatures) = self.aggregate.signatures.as_ref() else {
                            return None;
                        };
                        if aggregate_candidate_new_slice_is_already_covered(
                            aggregate_signatures,
                            &candidate.current_signatures,
                            candidate.matched,
                        ) {
                            rejected_covered_skip_fast_path = true;
                            return None;
                        }
                    }
                    Some(candidate)
                });
            let (candidate, used_adjacent_fast_path) = if rejected_covered_skip_fast_path {
                (None, true)
            } else if self.aggregate.axis == Some(axis) && lightweight_directed_candidate.is_some()
            {
                (lightweight_directed_candidate, true)
            } else {
                self.aggregate_signature_searches += 1;
                let exact_candidate =
                    find_aggregate_signature_match(&self.aggregate, &current, axis, self.options);
                (
                    choose_aggregate_match_candidate(exact_candidate, None, axis),
                    false,
                )
            };
            let Some(candidate) = candidate else {
                continue;
            };

            if best
                .as_ref()
                .map(|(_, current)| aggregate_match_is_better(candidate.matched, current.matched))
                .unwrap_or(true)
            {
                best = Some((axis, candidate));
                if used_adjacent_fast_path {
                    self.adjacent_fast_path_merges += 1;
                }
            }

            if self.aggregate.axis.is_none()
                && best.as_ref().map(|(best_axis, _)| *best_axis) == Some(axis)
            {
                break;
            }
        }

        let Some((axis, candidate)) = best else {
            if let Some(axis) = self.aggregate.axis {
                if aggregate_contains_current_frame(&self.aggregate, &current, axis, self.options) {
                    self.last_direction_reference_signatures = Some((
                        axis,
                        axis_signature_list(&current, axis),
                        DirectionReferenceSource::CoveredSkip,
                    ));
                }
            }
            self.skipped_frames += 1;
            crate::append_runtime_log_line(&format!(
                "long_capture aggregate_skip_no_overlap :: frame_index={} merged_frames={} locked_axis={:?}",
                frame_index, self.merged_frames, self.aggregate.axis
            ));
            return Ok(false);
        };

        if self.aggregate.axis.is_none() {
            self.aggregate.axis = Some(axis);
            let aggregate_image = aggregate_to_image(&self.aggregate, axis);
            self.aggregate.signatures = Some(axis_signature_list(&aggregate_image, axis));
        }

        let current_reference_signatures = candidate.current_signatures.clone();
        merge_frame_into_aggregate(&mut self.aggregate, &current, axis, candidate)?;
        self.merged_frames += 1;
        self.last_direction_reference_signatures = Some((
            axis,
            current_reference_signatures,
            DirectionReferenceSource::Merged,
        ));
        Ok(true)
    }

    fn finish_result(self) -> LongCaptureAggregateResult {
        let axis = self.aggregate.axis;
        LongCaptureAggregateResult {
            image: aggregate_into_image(self.aggregate),
            axis,
            merged_frames: self.merged_frames,
            skipped_frames: self.skipped_frames,
        }
    }

    pub fn into_image(self) -> RgbImage {
        aggregate_into_image(self.aggregate)
    }

    pub fn axis(&self) -> Option<LongCaptureAxis> {
        self.aggregate.axis
    }

    pub fn frame_count(&self) -> usize {
        self.frame_count
    }

    pub fn merged_frames(&self) -> usize {
        self.merged_frames
    }

    pub fn skipped_frames(&self) -> usize {
        self.skipped_frames
    }

    pub fn adjacent_fast_path_merges(&self) -> usize {
        self.adjacent_fast_path_merges
    }

    pub fn aggregate_signature_searches(&self) -> usize {
        self.aggregate_signature_searches
    }

    pub fn expensive_adjacent_pair_analyses(&self) -> usize {
        self.expensive_adjacent_pair_analyses
    }

    pub fn aggregate_segment_count(&self) -> usize {
        self.aggregate.segments.len()
    }
}

fn stitch_long_capture_frames_with_aggregate_signatures(
    frames: &[RgbImage],
    options: LongCaptureStitchOptions,
) -> Result<LongCaptureAggregateResult> {
    if frames.is_empty() {
        return Err(anyhow!("No frames to stitch"));
    }
    let inferred_axis = infer_axis_from_adjacent_frames(frames, options);
    let mut stitcher =
        LongCaptureIncrementalStitcher::new_with_axis(frames[0].clone(), options, inferred_axis);
    for current in frames.iter().skip(1) {
        stitcher.push_frame(current)?;
    }
    Ok(stitcher.finish_result())
}

pub fn stitch_long_capture_frames(
    frames: &[RgbImage],
    options: LongCaptureStitchOptions,
) -> Result<RgbImage> {
    let started_at = std::time::Instant::now();
    let result = stitch_long_capture_frames_with_aggregate_signatures(frames, options)?;
    crate::append_runtime_log_line(&format!(
        "long_capture stitch_complete :: input_frames={} merged_frames={} skipped_frames={} axis={:?} elapsed_ms={} width={} height={}",
        frames.len(),
        result.merged_frames,
        result.skipped_frames,
        result.axis,
        started_at.elapsed().as_millis(),
        result.image.width(),
        result.image.height()
    ));
    if result.skipped_frames > 0 {
        crate::append_runtime_log_line(&format!(
            "long_capture stitch_tolerant_complete :: input_frames={} skipped_frames={}",
            frames.len(),
            result.skipped_frames
        ));
    }
    Ok(result.image)
}

pub fn stitch_long_capture_frames_with_analyses(
    frames: &[RgbImage],
    analyses: &[LongCaptureOverlapAnalysis],
) -> Result<RgbImage> {
    if frames.is_empty() {
        return Err(anyhow!("No frames to stitch"));
    }
    if analyses.len() + 1 != frames.len() {
        return Err(anyhow!(
            "Long-capture analyses must line up with consecutive frame pairs"
        ));
    }
    if analyses.is_empty() {
        return Ok(frames[0].clone());
    }

    let mut stitched = frames[0].clone();
    let first_direction = analyses[0]
        .direction
        .ok_or_else(|| anyhow!("Long-capture direction is missing"))?;
    let stitch_axis = analyses[0]
        .axis
        .unwrap_or_else(|| direction_axis(first_direction));
    let mut previous_origin = 0i64;
    let mut min_origin = 0i64;
    let mut max_extent = match stitch_axis {
        LongCaptureAxis::Vertical => frames[0].height() as i64,
        LongCaptureAxis::Horizontal => frames[0].width() as i64,
    };

    for (index, analysis) in analyses.iter().enumerate() {
        let direction = analysis
            .direction
            .ok_or_else(|| anyhow!("Long-capture direction is missing"))?;
        let axis = analysis.axis.unwrap_or_else(|| direction_axis(direction));
        if axis != stitch_axis || direction_axis(direction) != stitch_axis {
            return Err(anyhow!(
                "Long-capture mixed-axis stitching is not supported"
            ));
        }

        let current = &frames[index + 1];
        let append_px = analysis.append_px as i64;
        if append_px <= 0 {
            continue;
        }

        match direction {
            LongCaptureDirection::Down => {
                if stitched.width() != current.width() {
                    return Err(anyhow!(
                        "Vertical long-capture frames must have the same width"
                    ));
                }
                let current_origin = previous_origin + append_px;
                let segment_start = current_origin + analysis.crop_start_px as i64;
                let segment_end = current_origin + current.height() as i64;
                let extension_start = segment_start.max(max_extent);
                if extension_start < segment_end {
                    let crop_y =
                        (analysis.crop_start_px as i64 + extension_start - segment_start) as u32;
                    let crop_h = (segment_end - extension_start) as u32;
                    let cropped =
                        imageops::crop_imm(current, 0, crop_y, current.width(), crop_h).to_image();
                    let mut next =
                        RgbImage::new(stitched.width(), stitched.height() + cropped.height());
                    imageops::replace(&mut next, &stitched, 0, 0);
                    imageops::replace(&mut next, &cropped, 0, stitched.height() as i64);
                    stitched = next;
                    max_extent = max_extent.max(segment_end);
                }
                previous_origin = current_origin;
            }
            LongCaptureDirection::Up => {
                if stitched.width() != current.width() {
                    return Err(anyhow!(
                        "Vertical long-capture frames must have the same width"
                    ));
                }
                let current_origin = previous_origin - append_px;
                let segment_start = current_origin;
                let segment_end = current_origin + append_px;
                let extension_end = segment_end.min(min_origin);
                if segment_start < extension_end {
                    let crop_h = (extension_end - segment_start) as u32;
                    let cropped =
                        imageops::crop_imm(current, 0, 0, current.width(), crop_h).to_image();
                    let mut next =
                        RgbImage::new(stitched.width(), stitched.height() + cropped.height());
                    imageops::replace(&mut next, &cropped, 0, 0);
                    imageops::replace(&mut next, &stitched, 0, cropped.height() as i64);
                    stitched = next;
                    min_origin = min_origin.min(segment_start);
                }
                previous_origin = current_origin;
            }
            LongCaptureDirection::Right => {
                if stitched.height() != current.height() {
                    return Err(anyhow!(
                        "Horizontal long-capture frames must have the same height"
                    ));
                }
                let current_origin = previous_origin + append_px;
                let segment_start = current_origin + analysis.crop_start_px as i64;
                let segment_end = current_origin + current.width() as i64;
                let extension_start = segment_start.max(max_extent);
                if extension_start < segment_end {
                    let crop_x =
                        (analysis.crop_start_px as i64 + extension_start - segment_start) as u32;
                    let crop_w = (segment_end - extension_start) as u32;
                    let cropped =
                        imageops::crop_imm(current, crop_x, 0, crop_w, current.height()).to_image();
                    let mut next =
                        RgbImage::new(stitched.width() + cropped.width(), stitched.height());
                    imageops::replace(&mut next, &stitched, 0, 0);
                    imageops::replace(&mut next, &cropped, stitched.width() as i64, 0);
                    stitched = next;
                    max_extent = max_extent.max(segment_end);
                }
                previous_origin = current_origin;
            }
            LongCaptureDirection::Left => {
                if stitched.height() != current.height() {
                    return Err(anyhow!(
                        "Horizontal long-capture frames must have the same height"
                    ));
                }
                let current_origin = previous_origin - append_px;
                let segment_start = current_origin;
                let segment_end = current_origin + append_px;
                let extension_end = segment_end.min(min_origin);
                if segment_start < extension_end {
                    let crop_w = (extension_end - segment_start) as u32;
                    let cropped =
                        imageops::crop_imm(current, 0, 0, crop_w, current.height()).to_image();
                    let mut next =
                        RgbImage::new(stitched.width() + cropped.width(), stitched.height());
                    imageops::replace(&mut next, &cropped, 0, 0);
                    imageops::replace(&mut next, &stitched, cropped.width() as i64, 0);
                    stitched = next;
                    min_origin = min_origin.min(segment_start);
                }
                previous_origin = current_origin;
            }
        }
    }
    Ok(stitched)
}

pub fn stitch_long_capture_frame_data_urls(
    frames: &[String],
    options: LongCaptureStitchOptions,
) -> Result<RgbImage> {
    if frames.is_empty() {
        return Err(anyhow!("No frames to stitch"));
    }

    let decoded_frames = frames
        .iter()
        .map(|frame| decode_frame_data_url(frame))
        .collect::<Result<Vec<_>>>()?;
    stitch_long_capture_frames(&decoded_frames, options)
}

pub fn stitch_vertical_frames(frames: &[RgbImage], max_overlap_scan: u32) -> Result<RgbImage> {
    if frames.is_empty() {
        return Err(anyhow!("No frames to stitch"));
    }

    let width = frames[0].width();
    if frames.iter().any(|frame| frame.width() != width) {
        return Err(anyhow!("All frames must have the same width"));
    }

    let mut total_height = frames[0].height();
    let mut overlaps = Vec::new();

    for index in 1..frames.len() {
        let overlap = find_vertical_overlap(&frames[index - 1], &frames[index], max_overlap_scan);
        overlaps.push(overlap);
        total_height += frames[index].height().saturating_sub(overlap);
    }

    let mut stitched = RgbImage::new(width, total_height);
    let mut cursor_y = 0u32;

    for (index, frame) in frames.iter().enumerate() {
        let skip = if index == 0 { 0 } else { overlaps[index - 1] };
        let crop_height = frame.height().saturating_sub(skip);
        let cropped = imageops::crop_imm(frame, 0, skip, frame.width(), crop_height).to_image();
        imageops::replace(&mut stitched, &cropped, 0, cursor_y as i64);
        cursor_y += crop_height;
    }

    Ok(stitched)
}

pub fn stitch_vertical_frame_data_urls(
    frames: &[String],
    max_overlap_scan: u32,
) -> Result<RgbImage> {
    if frames.is_empty() {
        return Err(anyhow!("No frames to stitch"));
    }

    let mut decoded_frames = Vec::with_capacity(frames.len());
    for frame in frames {
        let payload = frame
            .split_once(',')
            .map(|(_, payload)| payload)
            .unwrap_or(frame);
        let bytes = base64::engine::general_purpose::STANDARD.decode(payload)?;
        let image = image::load_from_memory(&bytes)?.to_rgb8();
        decoded_frames.push(image);
    }

    stitch_vertical_frames(&decoded_frames, max_overlap_scan)
}

pub fn capture_vertical_long_region(
    x: i32,
    y: i32,
    w: u32,
    h: u32,
    max_frames: u32,
    scroll_delta: i32,
    settle_ms: u64,
    overlap_scan: u32,
) -> Result<RgbImage> {
    crate::append_runtime_log_line(&format!(
        "long_capture start :: x={} y={} w={} h={} max_frames={} scroll_delta={} settle_ms={} overlap_scan={}",
        x, y, w, h, max_frames, scroll_delta, settle_ms, overlap_scan
    ));
    if max_frames == 0 {
        return Err(anyhow!("max_frames must be greater than zero"));
    }

    let mut frames = Vec::new();
    let center_x = x + (w as i32 / 2);
    let center_y = y + (h as i32 / 2);
    let (center_x_physical, center_y_physical) = logical_to_primary_physical(center_x, center_y);

    for index in 0..max_frames {
        let frame = screenshot::capture_area(x, y, w, h)?;
        crate::append_runtime_log_line(&format!(
            "long_capture frame_captured :: index={} width={} height={}",
            index,
            frame.width(),
            frame.height()
        ));
        let is_duplicate = frames
            .last()
            .map(|previous: &RgbImage| previous.as_raw() == frame.as_raw())
            .unwrap_or(false);
        if is_duplicate {
            #[cfg(target_os = "windows")]
            if !frames.is_empty() {
                crate::append_runtime_log_line(&format!(
                    "long_capture duplicate_frame_retry :: index={}",
                    index
                ));
                page_down_at_point(center_x_physical, center_y_physical);
                thread::sleep(Duration::from_millis(settle_ms));
                let retry_frame = screenshot::capture_area(x, y, w, h)?;
                let retry_duplicate = frames
                    .last()
                    .map(|previous: &RgbImage| previous.as_raw() == retry_frame.as_raw())
                    .unwrap_or(false);
                if !retry_duplicate {
                    crate::append_runtime_log_line(&format!(
                        "long_capture duplicate_retry_success :: index={} width={} height={}",
                        index,
                        retry_frame.width(),
                        retry_frame.height()
                    ));
                    frames.push(retry_frame);
                    continue;
                }
            }
            crate::append_runtime_log_line(&format!(
                "long_capture duplicate_frame_stop :: index={}",
                index
            ));
            break;
        }
        frames.push(frame);

        if index + 1 < max_frames {
            #[cfg(target_os = "windows")]
            {
                crate::append_runtime_log_line(&format!(
                    "long_capture scroll_step :: index={} center_x={} center_y={} physical_x={} physical_y={} delta={}",
                    index, center_x, center_y, center_x_physical, center_y_physical, scroll_delta
                ));
                scroll_vertical_at_point(center_x_physical, center_y_physical, scroll_delta);
                thread::sleep(Duration::from_millis(settle_ms));
            }
        }
    }

    let stitched = stitch_vertical_frames(&frames, overlap_scan)?;
    crate::append_runtime_log_line(&format!(
        "long_capture stitched :: frames={} width={} height={}",
        frames.len(),
        stitched.width(),
        stitched.height()
    ));
    Ok(stitched)
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::Rgb;

    fn solid_rows(width: u32, rows: &[[u8; 3]]) -> RgbImage {
        let mut img = RgbImage::new(width, rows.len() as u32);
        for (y, color) in rows.iter().enumerate() {
            for x in 0..width {
                img.put_pixel(x, y as u32, Rgb(*color));
            }
        }
        img
    }

    fn generated_line_color(value: u32) -> [u8; 3] {
        [
            ((value * 3 + 7) % 251) as u8,
            ((value * 5 + 17) % 251) as u8,
            ((value * 7 + 29) % 251) as u8,
        ]
    }

    fn generated_rows(start: u32, count: u32) -> Vec<[u8; 3]> {
        (start..start + count).map(generated_line_color).collect()
    }

    fn generated_columns(start: u32, count: u32) -> Vec<[u8; 3]> {
        (start..start + count).map(generated_line_color).collect()
    }

    fn unique_line_color(value: u32) -> [u8; 3] {
        [
            (value & 0xff) as u8,
            ((value >> 8) & 0xff) as u8,
            ((value * 37 + 19) % 251) as u8,
        ]
    }

    fn unique_rows(start: u32, count: u32) -> Vec<[u8; 3]> {
        (start..start + count).map(unique_line_color).collect()
    }

    fn unique_columns(start: u32, count: u32) -> Vec<[u8; 3]> {
        (start..start + count).map(unique_line_color).collect()
    }

    fn png_data_url(image: RgbImage) -> String {
        let mut bytes = Vec::new();
        image::DynamicImage::ImageRgb8(image)
            .write_to(
                &mut std::io::Cursor::new(&mut bytes),
                image::ImageFormat::Png,
            )
            .expect("png encode should succeed");
        format!(
            "data:image/png;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(bytes)
        )
    }

    #[test]
    fn detects_vertical_overlap_between_frames() {
        let previous = solid_rows(2, &[[10, 0, 0], [20, 0, 0], [30, 0, 0], [40, 0, 0]]);
        let current = solid_rows(2, &[[30, 0, 0], [40, 0, 0], [50, 0, 0], [60, 0, 0]]);
        let overlap = find_vertical_overlap(&previous, &current, 4);
        assert_eq!(overlap, 2);
    }

    #[test]
    fn stitches_vertical_frames_without_duplicate_overlap_rows() {
        let first = solid_rows(2, &[[10, 0, 0], [20, 0, 0], [30, 0, 0], [40, 0, 0]]);
        let second = solid_rows(2, &[[30, 0, 0], [40, 0, 0], [50, 0, 0], [60, 0, 0]]);
        let stitched = stitch_vertical_frames(&[first, second], 4).expect("stitch should succeed");
        assert_eq!(stitched.height(), 6);
        assert_eq!(stitched.get_pixel(0, 0).0, [10, 0, 0]);
        assert_eq!(stitched.get_pixel(0, 5).0, [60, 0, 0]);
    }

    #[test]
    fn stitches_long_capture_after_skipping_bad_recorded_frame() {
        let first = solid_rows(2, &[[10, 0, 0], [20, 0, 0], [30, 0, 0], [40, 0, 0]]);
        let bad = solid_rows(2, &[[180, 0, 0], [190, 0, 0], [200, 0, 0], [210, 0, 0]]);
        let second = solid_rows(2, &[[30, 0, 0], [40, 0, 0], [50, 0, 0], [60, 0, 0]]);

        let stitched = stitch_long_capture_frames(
            &[first, bad, second],
            LongCaptureStitchOptions {
                axis: Some(LongCaptureAxis::Vertical),
                direction: Some(LongCaptureDirection::Down),
                max_scan: Some(3),
                min_overlap_px: Some(1),
            },
        )
        .expect("bad middle frame should be skipped");

        assert_eq!(stitched.height(), 6);
        assert_eq!(stitched.get_pixel(0, 0).0, [10, 0, 0]);
        assert_eq!(stitched.get_pixel(0, 5).0, [60, 0, 0]);
    }

    #[test]
    fn stitches_long_capture_frames_from_recorded_pair_analyses() {
        let first = solid_rows(
            2,
            &[
                [10, 0, 0],
                [20, 0, 0],
                [30, 0, 0],
                [40, 0, 0],
                [50, 0, 0],
                [60, 0, 0],
            ],
        );
        let second = solid_rows(
            2,
            &[
                [40, 0, 0],
                [50, 0, 0],
                [60, 0, 0],
                [70, 0, 0],
                [80, 0, 0],
                [90, 0, 0],
            ],
        );
        let third = solid_rows(
            2,
            &[
                [70, 0, 0],
                [80, 0, 0],
                [90, 0, 0],
                [100, 0, 0],
                [110, 0, 0],
                [120, 0, 0],
            ],
        );

        let analysis_one = analyze_long_capture_pair_images(
            &first,
            &second,
            LongCaptureAnalyzeOptions {
                axis: Some(LongCaptureAxis::Vertical),
                direction: Some(LongCaptureDirection::Down),
                max_scan: Some(5),
                min_overlap_px: Some(1),
                min_new_content_px: Some(1),
            },
        );
        let analysis_two = analyze_long_capture_pair_images(
            &second,
            &third,
            LongCaptureAnalyzeOptions {
                axis: Some(LongCaptureAxis::Vertical),
                direction: Some(LongCaptureDirection::Down),
                max_scan: Some(5),
                min_overlap_px: Some(1),
                min_new_content_px: Some(1),
            },
        );

        let stitched = stitch_long_capture_frames_with_analyses(
            &[first, second, third],
            &[analysis_one, analysis_two],
        )
        .expect("recorded analyses should stitch without rescanning");

        assert_eq!(stitched.height(), 12);
        assert_eq!(stitched.get_pixel(0, 0).0, [10, 0, 0]);
        assert_eq!(stitched.get_pixel(0, 11).0, [120, 0, 0]);
    }

    #[test]
    fn stitches_vertical_frames_from_mixed_up_down_pair_analyses_without_duplicates() {
        let first_rows = generated_rows(50, 100);
        let second_rows = generated_rows(20, 100);
        let third_rows = generated_rows(80, 100);
        let fourth_rows = generated_rows(40, 100);
        let first = solid_rows(3, &first_rows);
        let second = solid_rows(3, &second_rows);
        let third = solid_rows(3, &third_rows);
        let fourth = solid_rows(3, &fourth_rows);

        let analysis_one = analyze_long_capture_pair_images(
            &first,
            &second,
            LongCaptureAnalyzeOptions {
                axis: Some(LongCaptureAxis::Vertical),
                direction: None,
                max_scan: Some(99),
                min_overlap_px: Some(1),
                min_new_content_px: Some(1),
            },
        );
        let analysis_two = analyze_long_capture_pair_images(
            &second,
            &third,
            LongCaptureAnalyzeOptions {
                axis: Some(LongCaptureAxis::Vertical),
                direction: None,
                max_scan: Some(99),
                min_overlap_px: Some(1),
                min_new_content_px: Some(1),
            },
        );
        let analysis_three = analyze_long_capture_pair_images(
            &third,
            &fourth,
            LongCaptureAnalyzeOptions {
                axis: Some(LongCaptureAxis::Vertical),
                direction: None,
                max_scan: Some(99),
                min_overlap_px: Some(1),
                min_new_content_px: Some(1),
            },
        );

        assert_eq!(analysis_one.direction, Some(LongCaptureDirection::Up));
        assert_eq!(analysis_two.direction, Some(LongCaptureDirection::Down));
        assert_eq!(analysis_three.direction, Some(LongCaptureDirection::Up));

        let stitched = stitch_long_capture_frames_with_analyses(
            &[first, second, third, fourth],
            &[analysis_one, analysis_two, analysis_three],
        )
        .expect("mixed vertical directions should stitch into the captured range");

        assert_eq!(stitched.height(), 160);
        assert_eq!(stitched.get_pixel(0, 0).0, generated_line_color(20));
        assert_eq!(stitched.get_pixel(0, 159).0, generated_line_color(179));
    }

    #[test]
    fn stitches_vertical_frames_when_direction_reverses_and_current_matches_earlier_frame() {
        let first_rows = generated_rows(70, 80);
        let above_rows = generated_rows(20, 80);
        let below_rows = generated_rows(120, 80);
        let first = solid_rows(3, &first_rows);
        let above = solid_rows(3, &above_rows);
        let below = solid_rows(3, &below_rows);

        let stitched = stitch_long_capture_frames(
            &[first, above, below],
            LongCaptureStitchOptions {
                axis: None,
                direction: None,
                max_scan: Some(79),
                min_overlap_px: Some(1),
            },
        )
        .expect("direction reversal should still stitch through an earlier overlapping frame");

        assert_eq!(stitched.height(), 180);
        assert_eq!(stitched.get_pixel(0, 0).0, generated_line_color(20));
        assert_eq!(stitched.get_pixel(0, 179).0, generated_line_color(199));
    }

    #[test]
    fn aggregate_signature_stitcher_handles_many_vertical_frames_by_matching_the_merged_image() {
        let positions = [
            100, 80, 60, 40, 20, 0, 40, 80, 120, 160, 200, 240, 220, 260, 300,
        ];
        let frames = positions
            .iter()
            .map(|start| solid_rows(4, &unique_rows(*start, 80)))
            .collect::<Vec<_>>();

        let result = stitch_long_capture_frames_with_aggregate_signatures(
            &frames,
            LongCaptureStitchOptions {
                axis: None,
                direction: None,
                max_scan: Some(79),
                min_overlap_px: Some(12),
            },
        )
        .expect("aggregate signature stitching should merge many back-and-forth frames");

        assert_eq!(result.axis, Some(LongCaptureAxis::Vertical));
        assert_eq!(result.image.height(), 380);
        assert_eq!(result.image.get_pixel(0, 0).0, unique_line_color(0));
        assert_eq!(result.image.get_pixel(0, 379).0, unique_line_color(379));
        assert!(result.merged_frames >= 10);
    }

    #[test]
    fn aggregate_signature_stitcher_handles_many_horizontal_frames_by_matching_the_merged_image() {
        let positions = [
            100, 80, 60, 40, 20, 0, 40, 80, 120, 160, 200, 240, 220, 260, 300,
        ];
        let frames = positions
            .iter()
            .map(|start| image_from_columns(4, &unique_columns(*start, 80)))
            .collect::<Vec<_>>();

        let result = stitch_long_capture_frames_with_aggregate_signatures(
            &frames,
            LongCaptureStitchOptions {
                axis: None,
                direction: None,
                max_scan: Some(79),
                min_overlap_px: Some(12),
            },
        )
        .expect("aggregate signature stitching should merge many horizontal frames");

        assert_eq!(result.axis, Some(LongCaptureAxis::Horizontal));
        assert_eq!(result.image.width(), 380);
        assert_eq!(result.image.get_pixel(0, 0).0, unique_line_color(0));
        assert_eq!(result.image.get_pixel(379, 0).0, unique_line_color(379));
        assert!(result.merged_frames >= 10);
    }

    #[test]
    fn aggregate_signature_stitcher_prunes_the_other_axis_after_locking() {
        let frames = [100, 80, 60, 40]
            .iter()
            .map(|start| solid_rows(4, &unique_rows(*start, 80)))
            .collect::<Vec<_>>();

        let result = stitch_long_capture_frames_with_aggregate_signatures(
            &frames,
            LongCaptureStitchOptions {
                axis: None,
                direction: None,
                max_scan: Some(79),
                min_overlap_px: Some(12),
            },
        )
        .expect("aggregate signature stitching should lock vertical axis");

        assert_eq!(result.axis, Some(LongCaptureAxis::Vertical));
    }

    #[test]
    fn aggregate_signature_stitcher_prefers_dense_true_overlap_over_far_repeated_block() {
        let mut rows = unique_rows(0, 140);
        for offset in 0..=40 {
            rows[(80 + offset) as usize] = rows[offset as usize];
        }

        let first = solid_rows(4, &rows[0..100]);
        let second = solid_rows(4, &rows[20..120]);

        let result = stitch_long_capture_frames_with_aggregate_signatures(
            &[first, second],
            LongCaptureStitchOptions {
                axis: Some(LongCaptureAxis::Vertical),
                direction: None,
                max_scan: Some(99),
                min_overlap_px: Some(12),
            },
        )
        .expect("repeated content should not cause a far false prepend");

        assert_eq!(result.axis, Some(LongCaptureAxis::Vertical));
        assert_eq!(result.image.height(), 120);
        assert_eq!(result.image.get_pixel(0, 0).0, rows[0]);
        assert_eq!(result.image.get_pixel(0, 119).0, rows[119]);
    }

    #[test]
    fn aggregate_signature_stitcher_only_appends_from_boundary_overlap_for_repeated_feed() {
        let mut rows = unique_rows(0, 220);
        for offset in 0..80usize {
            rows[80 + offset] = rows[20 + offset];
        }

        let first = solid_rows(4, &rows[0..120]);
        let second = solid_rows(4, &rows[80..200]);

        let result = stitch_long_capture_frames_with_aggregate_signatures(
            &[first, second],
            LongCaptureStitchOptions {
                axis: Some(LongCaptureAxis::Vertical),
                direction: None,
                max_scan: Some(119),
                min_overlap_px: Some(12),
            },
        )
        .expect("repeated internal content must not beat the true boundary overlap");

        assert_eq!(result.axis, Some(LongCaptureAxis::Vertical));
        assert_eq!(result.image.height(), 200);
        assert_eq!(result.image.get_pixel(0, 0).0, rows[0]);
        assert_eq!(result.image.get_pixel(0, 119).0, rows[119]);
        assert_eq!(result.image.get_pixel(0, 120).0, rows[120]);
        assert_eq!(result.image.get_pixel(0, 199).0, rows[199]);
    }

    #[test]
    fn aggregate_signature_stitcher_skips_frame_already_covered_by_aggregate() {
        let mut rows = unique_rows(0, 260);
        for offset in 0..80usize {
            rows[120 + offset] = rows[20 + offset];
        }

        let first = solid_rows(4, &rows[0..160]);
        let second = solid_rows(4, &rows[120..240]);
        let already_covered = solid_rows(4, &rows[80..200]);

        let result = stitch_long_capture_frames_with_aggregate_signatures(
            &[first, second, already_covered],
            LongCaptureStitchOptions {
                axis: Some(LongCaptureAxis::Vertical),
                direction: None,
                max_scan: Some(119),
                min_overlap_px: Some(12),
            },
        )
        .expect("already covered repeated content should be ignored instead of duplicated");

        assert_eq!(result.axis, Some(LongCaptureAxis::Vertical));
        assert_eq!(result.image.height(), 240);
        assert_eq!(result.image.get_pixel(0, 0).0, rows[0]);
        assert_eq!(result.image.get_pixel(0, 239).0, rows[239]);
    }

    #[test]
    fn aggregate_signature_stitcher_uses_adjacent_direction_when_scrolling_back_down() {
        let mut rows = unique_rows(0, 340);
        for offset in 0..60usize {
            rows[260 + offset] = rows[offset];
        }

        let first = solid_rows(4, &rows[100..220]);
        let above = solid_rows(4, &rows[0..120]);
        let first_again = solid_rows(4, &rows[100..220]);
        let mut below_rows = rows[200..320].to_vec();
        for color in below_rows.iter_mut().take(20) {
            color[0] = color[0].saturating_add(1);
            color[1] = color[1].saturating_add(1);
            color[2] = color[2].saturating_add(1);
        }
        let below = solid_rows(4, &below_rows);

        let result = stitch_long_capture_frames_with_aggregate_signatures(
            &[first, above, first_again, below],
            LongCaptureStitchOptions {
                axis: Some(LongCaptureAxis::Vertical),
                direction: None,
                max_scan: Some(119),
                min_overlap_px: Some(16),
            },
        )
        .expect("scrolling down after capturing above should append below, not prepend a repeated block");

        assert_eq!(result.axis, Some(LongCaptureAxis::Vertical));
        assert_eq!(result.image.height(), 320);
        assert_eq!(result.image.get_pixel(0, 0).0, rows[0]);
        assert_eq!(result.image.get_pixel(0, 219).0, rows[219]);
        assert_eq!(result.image.get_pixel(0, 319).0, below_rows[119]);
    }

    #[test]
    fn aggregate_signature_stitcher_does_not_drop_valid_frame_after_skipped_direction_hint() {
        let rows = unique_rows(0, 260);
        let first = solid_rows(4, &rows[100..220]);
        let skipped_above = solid_rows(4, &rows[0..120]);
        let partially_above = solid_rows(4, &rows[80..200]);

        let result = stitch_long_capture_frames_with_aggregate_signatures(
            &[first, skipped_above, partially_above],
            LongCaptureStitchOptions {
                axis: Some(LongCaptureAxis::Vertical),
                direction: None,
                max_scan: Some(119),
                min_overlap_px: Some(32),
            },
        )
        .expect("a skipped previous frame must not force the next valid aggregate match direction");

        assert_eq!(result.axis, Some(LongCaptureAxis::Vertical));
        assert_eq!(result.image.height(), 140);
        assert_eq!(result.image.get_pixel(0, 0).0, rows[80]);
        assert_eq!(result.image.get_pixel(0, 139).0, rows[219]);
        assert_eq!(result.skipped_frames, 1);
    }

    #[test]
    fn incremental_signature_stitcher_matches_batch_result_for_mixed_scroll() {
        let positions = [100, 80, 60, 40, 20, 0, 40, 80, 120, 160, 200, 240];
        let frames = positions
            .iter()
            .map(|start| solid_rows(4, &unique_rows(*start, 80)))
            .collect::<Vec<_>>();
        let options = LongCaptureStitchOptions {
            axis: Some(LongCaptureAxis::Vertical),
            direction: None,
            max_scan: Some(79),
            min_overlap_px: Some(12),
        };

        let batch = stitch_long_capture_frames_with_aggregate_signatures(&frames, options)
            .expect("batch stitching should work");
        let mut incremental = LongCaptureIncrementalStitcher::new(frames[0].clone(), options);
        for frame in frames.iter().skip(1) {
            incremental
                .push_frame(frame)
                .expect("incremental stitching should accept the same frame sequence");
        }
        let incremental_axis = incremental.axis();
        let incremental_merged_frames = incremental.merged_frames();
        let incremental_skipped_frames = incremental.skipped_frames();
        let incremental_image = incremental.into_image();

        assert_eq!(incremental_axis, batch.axis);
        assert_eq!(incremental_merged_frames, batch.merged_frames);
        assert_eq!(incremental_skipped_frames, batch.skipped_frames);
        assert_eq!(incremental_image.dimensions(), batch.image.dimensions());
        assert_eq!(incremental_image.as_raw(), batch.image.as_raw());
    }

    #[test]
    fn incremental_signature_stitcher_uses_adjacent_boundary_fast_path_for_sequential_scroll() {
        let positions = [0, 24, 48, 72, 96, 120];
        let frames = positions
            .iter()
            .map(|start| solid_rows(4, &unique_rows(*start, 120)))
            .collect::<Vec<_>>();
        let options = LongCaptureStitchOptions {
            axis: Some(LongCaptureAxis::Vertical),
            direction: None,
            max_scan: Some(119),
            min_overlap_px: Some(16),
        };

        let mut incremental = LongCaptureIncrementalStitcher::new(frames[0].clone(), options);
        for frame in frames.iter().skip(1) {
            incremental
                .push_frame(frame)
                .expect("sequential scroll frame should merge");
        }

        assert_eq!(incremental.axis(), Some(LongCaptureAxis::Vertical));
        assert_eq!(incremental.adjacent_fast_path_merges(), 5);
        assert_eq!(incremental.aggregate_signature_searches(), 0);
        assert_eq!(incremental.expensive_adjacent_pair_analyses(), 0);
        assert_eq!(incremental.aggregate_segment_count(), 6);
        assert_eq!(incremental.into_image().height(), 240);
    }

    #[test]
    fn incremental_signature_stitcher_skips_reverse_frames_already_inside_aggregate_without_expensive_pair_analysis(
    ) {
        let positions = [0, 40, 80, 120, 160, 120, 80, 40, 0];
        let frames = positions
            .iter()
            .map(|start| solid_rows(4, &unique_rows(*start, 120)))
            .collect::<Vec<_>>();
        let options = LongCaptureStitchOptions {
            axis: Some(LongCaptureAxis::Vertical),
            direction: None,
            max_scan: Some(119),
            min_overlap_px: Some(16),
        };

        let mut incremental = LongCaptureIncrementalStitcher::new(frames[0].clone(), options);
        for frame in frames.iter().skip(1) {
            incremental
                .push_frame(frame)
                .expect("covered reverse frame should be skipped cheaply");
        }

        assert_eq!(incremental.axis(), Some(LongCaptureAxis::Vertical));
        assert_eq!(incremental.merged_frames(), 5);
        assert_eq!(incremental.skipped_frames(), 4);
        assert_eq!(incremental.expensive_adjacent_pair_analyses(), 0);
        assert_eq!(incremental.into_image().height(), 280);
    }

    #[test]
    fn incremental_signature_stitcher_rejects_boundary_match_when_appended_slice_is_already_covered(
    ) {
        let positions = [0, 40, 80, 120, 160];
        let frames = positions
            .iter()
            .map(|start| solid_rows(4, &unique_rows(*start, 120)))
            .collect::<Vec<_>>();
        let options = LongCaptureStitchOptions {
            axis: Some(LongCaptureAxis::Vertical),
            direction: None,
            max_scan: Some(119),
            min_overlap_px: Some(16),
        };

        let mut false_append_rows = unique_rows(200, 80);
        false_append_rows.extend(unique_rows(60, 40));
        let false_append_frame = solid_rows(4, &false_append_rows);

        let mut incremental = LongCaptureIncrementalStitcher::new(frames[0].clone(), options);
        for frame in frames.iter().skip(1) {
            incremental
                .push_frame(frame)
                .expect("sequential scroll frame should merge");
        }
        let covered_boundary_frame = solid_rows(4, &unique_rows(160, 120));
        let covered_merged = incremental
            .push_frame(&covered_boundary_frame)
            .expect("covered boundary frame should be skipped");
        assert!(!covered_merged);

        let merged = incremental
            .push_frame(&false_append_frame)
            .expect("covered append slice should be rejected cheaply");

        assert!(!merged);
        assert_eq!(incremental.axis(), Some(LongCaptureAxis::Vertical));
        assert_eq!(incremental.merged_frames(), 5);
        assert_eq!(incremental.skipped_frames(), 2);
        assert_eq!(incremental.expensive_adjacent_pair_analyses(), 0);
        assert_eq!(incremental.into_image().height(), 280);
    }

    #[test]
    fn incremental_signature_stitcher_skips_disconnected_recorded_frames_without_expensive_pair_analysis(
    ) {
        let positions = [0, 40, 80, 120, 160, 1000, 1040, 1080, 1120];
        let frames = positions
            .iter()
            .map(|start| solid_rows(4, &unique_rows(*start, 120)))
            .collect::<Vec<_>>();
        let options = LongCaptureStitchOptions {
            axis: Some(LongCaptureAxis::Vertical),
            direction: None,
            max_scan: Some(119),
            min_overlap_px: Some(16),
        };

        let mut incremental = LongCaptureIncrementalStitcher::new(frames[0].clone(), options);
        for frame in frames.iter().skip(1) {
            incremental
                .push_frame(frame)
                .expect("disconnected frames should be skipped cheaply");
        }

        assert_eq!(incremental.axis(), Some(LongCaptureAxis::Vertical));
        assert_eq!(incremental.merged_frames(), 5);
        assert_eq!(incremental.skipped_frames(), 4);
        assert_eq!(incremental.expensive_adjacent_pair_analyses(), 0);
        assert_eq!(incremental.into_image().height(), 280);
    }

    #[test]
    fn aggregate_signature_stitcher_ignores_dynamic_vertical_scrollbar_edge() {
        fn mail_reader_frame(scroll_y: u32, scrollbar_color: [u8; 3]) -> RgbImage {
            let width = 240;
            let height = 120;
            let stable_content_end = 218;
            let mut image = RgbImage::from_pixel(width, height, Rgb([248, 249, 250]));

            for y in 0..height {
                let color = unique_line_color(scroll_y + y);
                for x in 16..stable_content_end {
                    image.put_pixel(x, y, Rgb(color));
                }
                for x in stable_content_end..width {
                    image.put_pixel(x, y, Rgb(scrollbar_color));
                }
            }

            image
        }

        let first = mail_reader_frame(0, [210, 210, 210]);
        let second = mail_reader_frame(40, [120, 120, 120]);

        let result = stitch_long_capture_frames_with_aggregate_signatures(
            &[first, second],
            LongCaptureStitchOptions {
                axis: Some(LongCaptureAxis::Vertical),
                direction: None,
                max_scan: Some(119),
                min_overlap_px: Some(12),
            },
        )
        .expect("dynamic scrollbar edge should not prevent stitching stable mail content");

        assert_eq!(result.axis, Some(LongCaptureAxis::Vertical));
        assert_eq!(result.image.height(), 160);
        assert_eq!(result.image.get_pixel(16, 0).0, unique_line_color(0));
        assert_eq!(result.image.get_pixel(16, 159).0, unique_line_color(159));
    }

    #[test]
    fn aggregate_signature_stitcher_merges_sparse_inbox_rows_scrolled_both_ways() {
        fn draw_inbox_text_bar(image: &mut RgbImage, x: u32, y: u32, width: u32, color: [u8; 3]) {
            for yy in y..(y + 3).min(image.height()) {
                for xx in x..(x + width).min(image.width()) {
                    image.put_pixel(xx, yy, Rgb(color));
                }
            }
        }

        fn inbox_frame(scroll_y: u32) -> RgbImage {
            let width = 640;
            let height = 144;
            let row_h = 48;
            let mut image = RgbImage::from_pixel(width, height, Rgb([255, 255, 255]));

            for y in 0..height {
                let doc_y = scroll_y + y;
                let row = doc_y / row_h;
                let in_row = doc_y % row_h;
                if in_row == row_h - 1 {
                    for x in 0..width {
                        image.put_pixel(x, y, Rgb([232, 232, 232]));
                    }
                    continue;
                }

                if (10..30).contains(&in_row) {
                    for x in 12..30 {
                        image.put_pixel(x, y, Rgb([235, 235, 235]));
                    }
                }

                let color = [
                    (20 + (row * 17 % 140)) as u8,
                    (20 + (row * 29 % 140)) as u8,
                    (20 + (row * 37 % 140)) as u8,
                ];
                if in_row == 15 {
                    draw_inbox_text_bar(&mut image, 70, y, 48 + (row % 5) * 12, color);
                    draw_inbox_text_bar(&mut image, 214, y, 140 + (row % 7) * 18, color);
                    draw_inbox_text_bar(&mut image, 590, y, 28, color);
                }
                if in_row == 26 {
                    draw_inbox_text_bar(&mut image, 214, y, 90 + (row % 4) * 20, [90, 90, 90]);
                }
            }

            image
        }

        let positions = [144, 96, 48, 0, 192, 240, 288];
        let frames = positions
            .iter()
            .map(|start| inbox_frame(*start))
            .collect::<Vec<_>>();

        let result = stitch_long_capture_frames_with_aggregate_signatures(
            &frames,
            LongCaptureStitchOptions {
                axis: None,
                direction: None,
                max_scan: Some(143),
                min_overlap_px: Some(16),
            },
        )
        .expect("sparse inbox rows should stitch when sampled while scrolling both ways");

        assert_eq!(result.axis, Some(LongCaptureAxis::Vertical));
        assert_eq!(result.image.height(), 432);
        assert_eq!(result.skipped_frames, 0);
    }

    #[test]
    fn aggregate_signature_stitcher_does_not_lock_horizontal_from_blank_columns() {
        fn vertical_page_frame(scroll_y: u32, render_jitter: u8) -> RgbImage {
            let width = 360;
            let height = 160;
            let mut image = RgbImage::from_pixel(width, height, Rgb([255, 255, 255]));

            for y in 0..height {
                let doc_y = scroll_y + y;
                let color = unique_line_color(doc_y);
                let jittered = [
                    color[0].saturating_add(render_jitter),
                    color[1].saturating_add(render_jitter),
                    color[2].saturating_add(render_jitter),
                ];
                for x in 80..280 {
                    if (x + doc_y) % 11 <= 4 {
                        image.put_pixel(x, y, Rgb(jittered));
                    }
                }
            }

            image
        }

        let first = vertical_page_frame(0, 0);
        let second = vertical_page_frame(36, 1);

        let result = stitch_long_capture_frames_with_aggregate_signatures(
            &[first, second],
            LongCaptureStitchOptions {
                axis: None,
                direction: None,
                max_scan: Some(159),
                min_overlap_px: Some(16),
            },
        )
        .expect("blank columns must not produce a false horizontal long capture");

        assert_ne!(result.axis, Some(LongCaptureAxis::Horizontal));
        assert_eq!(result.image.width(), 360);
    }

    #[test]
    fn stitches_horizontal_frames_from_mixed_left_right_pair_analyses_without_duplicates() {
        let first_columns = generated_columns(50, 100);
        let second_columns = generated_columns(20, 100);
        let third_columns = generated_columns(80, 100);
        let fourth_columns = generated_columns(40, 100);
        let first = image_from_columns(3, &first_columns);
        let second = image_from_columns(3, &second_columns);
        let third = image_from_columns(3, &third_columns);
        let fourth = image_from_columns(3, &fourth_columns);

        let analysis_one = analyze_long_capture_pair_images(
            &first,
            &second,
            LongCaptureAnalyzeOptions {
                axis: Some(LongCaptureAxis::Horizontal),
                direction: None,
                max_scan: Some(99),
                min_overlap_px: Some(1),
                min_new_content_px: Some(1),
            },
        );
        let analysis_two = analyze_long_capture_pair_images(
            &second,
            &third,
            LongCaptureAnalyzeOptions {
                axis: Some(LongCaptureAxis::Horizontal),
                direction: None,
                max_scan: Some(99),
                min_overlap_px: Some(1),
                min_new_content_px: Some(1),
            },
        );
        let analysis_three = analyze_long_capture_pair_images(
            &third,
            &fourth,
            LongCaptureAnalyzeOptions {
                axis: Some(LongCaptureAxis::Horizontal),
                direction: None,
                max_scan: Some(99),
                min_overlap_px: Some(1),
                min_new_content_px: Some(1),
            },
        );

        assert_eq!(analysis_one.direction, Some(LongCaptureDirection::Left));
        assert_eq!(analysis_two.direction, Some(LongCaptureDirection::Right));
        assert_eq!(analysis_three.direction, Some(LongCaptureDirection::Left));

        let stitched = stitch_long_capture_frames_with_analyses(
            &[first, second, third, fourth],
            &[analysis_one, analysis_two, analysis_three],
        )
        .expect("mixed horizontal directions should stitch into the captured range");

        assert_eq!(stitched.width(), 160);
        assert_eq!(stitched.get_pixel(0, 0).0, generated_line_color(20));
        assert_eq!(stitched.get_pixel(159, 0).0, generated_line_color(179));
    }

    #[test]
    fn stitches_horizontal_frames_when_direction_reverses_and_current_matches_earlier_frame() {
        let first_columns = generated_columns(70, 80);
        let left_columns = generated_columns(20, 80);
        let right_columns = generated_columns(120, 80);
        let first = image_from_columns(3, &first_columns);
        let left = image_from_columns(3, &left_columns);
        let right = image_from_columns(3, &right_columns);

        let stitched = stitch_long_capture_frames(
            &[first, left, right],
            LongCaptureStitchOptions {
                axis: None,
                direction: None,
                max_scan: Some(79),
                min_overlap_px: Some(1),
            },
        )
        .expect("horizontal direction reversal should stitch through an earlier overlapping frame");

        assert_eq!(stitched.width(), 180);
        assert_eq!(stitched.get_pixel(0, 0).0, generated_line_color(20));
        assert_eq!(stitched.get_pixel(179, 0).0, generated_line_color(199));
    }

    #[test]
    fn stitches_vertical_frame_data_urls_for_manual_capture() {
        let first = png_data_url(solid_rows(
            2,
            &[[10, 0, 0], [20, 0, 0], [30, 0, 0], [40, 0, 0]],
        ));
        let second = png_data_url(solid_rows(
            2,
            &[[30, 0, 0], [40, 0, 0], [50, 0, 0], [60, 0, 0]],
        ));
        let stitched =
            stitch_vertical_frame_data_urls(&[first, second], 4).expect("stitch should succeed");
        assert_eq!(stitched.height(), 6);
        assert_eq!(stitched.get_pixel(0, 0).0, [10, 0, 0]);
        assert_eq!(stitched.get_pixel(0, 5).0, [60, 0, 0]);
    }

    #[test]
    fn analyzes_vertical_down_overlap_from_boundary_rows() {
        let previous = solid_rows(
            2,
            &[
                [10, 0, 0],
                [20, 0, 0],
                [30, 0, 0],
                [40, 0, 0],
                [50, 0, 0],
                [60, 0, 0],
            ],
        );
        let current = solid_rows(
            2,
            &[
                [40, 0, 0],
                [50, 0, 0],
                [60, 0, 0],
                [70, 0, 0],
                [80, 0, 0],
                [90, 0, 0],
            ],
        );

        let analysis = analyze_long_capture_pair_images(
            &previous,
            &current,
            LongCaptureAnalyzeOptions {
                axis: None,
                direction: None,
                max_scan: Some(5),
                min_overlap_px: Some(1),
                min_new_content_px: Some(1),
            },
        );

        assert_eq!(analysis.status, LongCaptureOverlapStatus::Good);
        assert_eq!(analysis.axis, Some(LongCaptureAxis::Vertical));
        assert_eq!(analysis.direction, Some(LongCaptureDirection::Down));
        assert_eq!(analysis.overlap_px, 3);
        assert_eq!(analysis.crop_start_px, 3);
        assert_eq!(analysis.append_px, 3);
        assert!(analysis.confidence >= 0.9);
    }

    #[test]
    fn analyzes_horizontal_right_overlap_from_boundary_columns() {
        let previous = image_from_columns(
            2,
            &[[10, 0, 0], [20, 0, 0], [30, 0, 0], [40, 0, 0], [50, 0, 0]],
        );
        let current = image_from_columns(
            2,
            &[[30, 0, 0], [40, 0, 0], [50, 0, 0], [60, 0, 0], [70, 0, 0]],
        );

        let analysis = analyze_long_capture_pair_images(
            &previous,
            &current,
            LongCaptureAnalyzeOptions {
                axis: None,
                direction: None,
                max_scan: Some(4),
                min_overlap_px: Some(1),
                min_new_content_px: Some(1),
            },
        );

        assert_eq!(analysis.status, LongCaptureOverlapStatus::Good);
        assert_eq!(analysis.axis, Some(LongCaptureAxis::Horizontal));
        assert_eq!(analysis.direction, Some(LongCaptureDirection::Right));
        assert_eq!(analysis.overlap_px, 3);
        assert_eq!(analysis.crop_start_px, 3);
        assert_eq!(analysis.append_px, 2);
        assert!(analysis.confidence >= 0.9);
    }

    #[test]
    fn analyzes_vertical_up_overlap_when_first_scroll_is_up() {
        let previous_rows = generated_rows(30, 100);
        let current_rows = generated_rows(0, 100);
        let previous = solid_rows(3, &previous_rows);
        let current = solid_rows(3, &current_rows);

        let analysis = analyze_long_capture_pair_images(
            &previous,
            &current,
            LongCaptureAnalyzeOptions {
                axis: None,
                direction: None,
                max_scan: Some(99),
                min_overlap_px: Some(1),
                min_new_content_px: Some(1),
            },
        );

        assert_eq!(analysis.status, LongCaptureOverlapStatus::Good);
        assert_eq!(analysis.axis, Some(LongCaptureAxis::Vertical));
        assert_eq!(analysis.direction, Some(LongCaptureDirection::Up));
        assert_eq!(analysis.append_px, 30);
    }

    #[test]
    fn analyzes_horizontal_left_overlap_when_first_scroll_is_left() {
        let previous_columns = generated_columns(30, 100);
        let current_columns = generated_columns(0, 100);
        let previous = image_from_columns(3, &previous_columns);
        let current = image_from_columns(3, &current_columns);

        let analysis = analyze_long_capture_pair_images(
            &previous,
            &current,
            LongCaptureAnalyzeOptions {
                axis: None,
                direction: None,
                max_scan: Some(99),
                min_overlap_px: Some(1),
                min_new_content_px: Some(1),
            },
        );

        assert_eq!(analysis.status, LongCaptureOverlapStatus::Good);
        assert_eq!(analysis.axis, Some(LongCaptureAxis::Horizontal));
        assert_eq!(analysis.direction, Some(LongCaptureDirection::Left));
        assert_eq!(analysis.append_px, 30);
    }

    #[test]
    fn rejects_pair_without_overlap() {
        let previous = solid_rows(2, &[[10, 0, 0], [20, 0, 0], [30, 0, 0], [40, 0, 0]]);
        let current = solid_rows(2, &[[80, 0, 0], [90, 0, 0], [100, 0, 0], [110, 0, 0]]);

        let analysis = analyze_long_capture_pair_images(
            &previous,
            &current,
            LongCaptureAnalyzeOptions {
                axis: None,
                direction: None,
                max_scan: Some(3),
                min_overlap_px: Some(1),
                min_new_content_px: Some(1),
            },
        );

        assert_eq!(analysis.status, LongCaptureOverlapStatus::NoOverlap);
        assert!(analysis.confidence < 0.65);
    }

    #[test]
    fn caps_cross_axis_samples_for_large_capture_regions() {
        assert!(sampled_cross_axis_offsets(3840, 0).len() <= 192);
        assert!(sampled_cross_axis_offsets(2160, 8).len() <= 192);
        assert_eq!(sampled_cross_axis_offsets(4, 0), vec![0, 1, 2, 3]);
    }

    #[test]
    fn treats_tiny_capture_noise_as_duplicate_without_full_overlap_search() {
        let previous = solid_rows(240, &[[248, 248, 248]; 120]);
        let mut current = previous.clone();
        current.put_pixel(11, 9, Rgb([246, 246, 246]));
        current.put_pixel(113, 58, Rgb([249, 249, 249]));
        current.put_pixel(201, 111, Rgb([247, 247, 247]));

        let analysis = analyze_long_capture_pair_images(
            &previous,
            &current,
            LongCaptureAnalyzeOptions {
                axis: Some(LongCaptureAxis::Vertical),
                direction: Some(LongCaptureDirection::Down),
                max_scan: None,
                min_overlap_px: Some(1),
                min_new_content_px: Some(1),
            },
        );

        assert_eq!(analysis.status, LongCaptureOverlapStatus::Duplicate);
        assert_eq!(analysis.append_px, 0);
    }

    #[test]
    fn rejects_small_boundary_only_match_without_real_overlap() {
        let mut previous_rows = Vec::new();
        for y in 0..100u8 {
            previous_rows.push([
                ((y as u32 * 11) % 251) as u8,
                ((y as u32 * 17 + 40) % 251) as u8,
                ((y as u32 * 23 + 80) % 251) as u8,
            ]);
        }
        for _ in 0..20 {
            previous_rows.push([255, 255, 255]);
        }

        let mut current_rows = Vec::new();
        for _ in 0..20 {
            current_rows.push([255, 255, 255]);
        }
        for y in 0..100u8 {
            current_rows.push([
                ((y as u32 * 29 + 13) % 251) as u8,
                ((y as u32 * 31 + 90) % 251) as u8,
                ((y as u32 * 37 + 120) % 251) as u8,
            ]);
        }

        let previous = solid_rows(4, &previous_rows);
        let current = solid_rows(4, &current_rows);

        let analysis = analyze_long_capture_pair_images(
            &previous,
            &current,
            LongCaptureAnalyzeOptions {
                axis: Some(LongCaptureAxis::Vertical),
                direction: Some(LongCaptureDirection::Down),
                max_scan: Some(60),
                min_overlap_px: None,
                min_new_content_px: Some(8),
            },
        );

        assert_eq!(analysis.status, LongCaptureOverlapStatus::NoOverlap);
    }

    #[test]
    fn detects_tiny_scroll_overlap_from_high_frequency_sampling() {
        fn generated_rows(start: u32, count: u32) -> Vec<[u8; 3]> {
            (start..start + count)
                .map(|value| {
                    [
                        ((value * 3) % 251) as u8,
                        ((value * 5 + 17) % 251) as u8,
                        ((value * 7 + 29) % 251) as u8,
                    ]
                })
                .collect()
        }

        let previous_rows = generated_rows(0, 100);
        let current_rows = generated_rows(10, 100);
        let previous = solid_rows(3, &previous_rows);
        let current = solid_rows(3, &current_rows);

        let analysis = analyze_long_capture_pair_images(
            &previous,
            &current,
            LongCaptureAnalyzeOptions {
                axis: Some(LongCaptureAxis::Vertical),
                direction: Some(LongCaptureDirection::Down),
                max_scan: None,
                min_overlap_px: Some(1),
                min_new_content_px: Some(1),
            },
        );

        assert_eq!(analysis.status, LongCaptureOverlapStatus::Good);
        assert_eq!(analysis.overlap_px, 90);
        assert_eq!(analysis.append_px, 10);
    }

    #[test]
    fn detects_sub_minimum_scroll_when_default_scan_is_used() {
        fn generated_rows(start: u32, count: u32) -> Vec<[u8; 3]> {
            (start..start + count)
                .map(|value| {
                    [
                        ((value * 11 + 3) % 251) as u8,
                        ((value * 13 + 19) % 251) as u8,
                        ((value * 17 + 37) % 251) as u8,
                    ]
                })
                .collect()
        }

        let previous = solid_rows(3, &generated_rows(0, 100));
        let current = solid_rows(3, &generated_rows(2, 100));

        let analysis = analyze_long_capture_pair_images(
            &previous,
            &current,
            LongCaptureAnalyzeOptions {
                axis: Some(LongCaptureAxis::Vertical),
                direction: Some(LongCaptureDirection::Down),
                max_scan: None,
                min_overlap_px: Some(1),
                min_new_content_px: Some(1),
            },
        );

        assert_eq!(analysis.status, LongCaptureOverlapStatus::Good);
        assert_eq!(analysis.overlap_px, 98);
        assert_eq!(analysis.append_px, 2);
    }

    #[test]
    fn prefers_document_overlap_over_static_sidebar_and_blank_background() {
        fn article_frame(scroll_y: u32) -> RgbImage {
            let width = 120;
            let height = 140;
            let mut image = RgbImage::from_pixel(width, height, Rgb([250, 250, 250]));

            for viewport_y in 0..height {
                let doc_y = scroll_y + viewport_y;

                if doc_y % 19 <= 2 {
                    let text_end = 18 + ((doc_y / 19) % 42);
                    for x in 8..text_end.min(70) {
                        image.put_pixel(x, viewport_y, Rgb([24, 24, 24]));
                    }
                }
                if doc_y % 47 == 11 {
                    for y in viewport_y..(viewport_y + 4).min(height) {
                        for x in 8..62 {
                            image.put_pixel(x, y, Rgb([70, 70, 70]));
                        }
                    }
                }

                for x in 80..width {
                    image.put_pixel(x, viewport_y, Rgb([238, 238, 238]));
                }
            }

            image
        }

        let previous = article_frame(0);
        let current = article_frame(30);

        let analysis = analyze_long_capture_pair_images(
            &previous,
            &current,
            LongCaptureAnalyzeOptions {
                axis: Some(LongCaptureAxis::Vertical),
                direction: Some(LongCaptureDirection::Down),
                max_scan: Some(132),
                min_overlap_px: Some(16),
                min_new_content_px: Some(1),
            },
        );

        assert_eq!(analysis.status, LongCaptureOverlapStatus::Good);
        assert_eq!(analysis.direction, Some(LongCaptureDirection::Down));
        assert_eq!(analysis.overlap_px, 110);
        assert_eq!(analysis.append_px, 30);
    }

    #[test]
    fn does_not_follow_static_sidebar_when_article_column_scrolls() {
        fn sticky_sidebar_article_frame(scroll_y: u32) -> RgbImage {
            let width = 400;
            let height = 160;
            let mut image = RgbImage::from_pixel(width, height, Rgb([250, 250, 250]));

            for viewport_y in 0..height {
                let doc_y = scroll_y + viewport_y;

                for x in 0..46 {
                    image.put_pixel(x, viewport_y, Rgb([254, 254, 254]));
                }

                if doc_y % 17 == 0 {
                    let text_end = 8 + ((doc_y * 13) % 34);
                    for x in 8..text_end {
                        image.put_pixel(x, viewport_y, Rgb([20, 20, 20]));
                    }
                }

                for x in 46..280 {
                    image.put_pixel(x, viewport_y, Rgb([250, 250, 250]));
                }

                for x in 280..width {
                    let tint = if (viewport_y / 16) % 2 == 0 { 236 } else { 230 };
                    image.put_pixel(x, viewport_y, Rgb([tint, tint, tint]));
                }
            }

            image
        }

        let previous = sticky_sidebar_article_frame(0);
        let current = sticky_sidebar_article_frame(36);

        let analysis = analyze_long_capture_pair_images(
            &previous,
            &current,
            LongCaptureAnalyzeOptions {
                axis: Some(LongCaptureAxis::Vertical),
                direction: Some(LongCaptureDirection::Down),
                max_scan: Some(159),
                min_overlap_px: Some(16),
                min_new_content_px: Some(8),
            },
        );

        assert_eq!(analysis.status, LongCaptureOverlapStatus::Good);
        assert_eq!(analysis.overlap_px, 124);
        assert_eq!(analysis.append_px, 36);
    }

    #[test]
    fn gmail_like_inbox_prefers_true_scroll_delta_under_fixed_chrome() {
        fn draw_email_row(
            image: &mut RgbImage,
            y: u32,
            row_height: u32,
            list_x: u32,
            list_w: u32,
            email_index: u32,
        ) {
            let row_bottom = (y + row_height).min(image.height());
            for row_y in y..row_bottom {
                for x in list_x..(list_x + list_w).min(image.width()) {
                    image.put_pixel(x, row_y, Rgb([255, 255, 255]));
                }
            }

            for x in list_x..(list_x + list_w).min(image.width()) {
                image.put_pixel(x, y, Rgb([232, 234, 237]));
            }

            let checkbox_x = list_x + 10;
            for px in checkbox_x..checkbox_x + 12 {
                for py in y + 6..(y + 14).min(row_bottom) {
                    image.put_pixel(px, py, Rgb([189, 193, 198]));
                }
            }

            let sender_width = 28 + ((email_index * 7) % 5);
            for px in list_x + 42..(list_x + 42 + sender_width).min(image.width()) {
                for py in y + 7..(y + 10).min(row_bottom) {
                    image.put_pixel(px, py, Rgb([32, 33, 36]));
                }
            }

            let subject_width = 86 + ((email_index * 11) % 9);
            for px in list_x + 112..(list_x + 112 + subject_width).min(image.width()) {
                for py in y + 8..(y + 11).min(row_bottom) {
                    image.put_pixel(px, py, Rgb([60, 64, 67]));
                }
            }

            let unique_anchor_x = list_x + 218 + ((email_index * 13) % 17);
            for px in unique_anchor_x..(unique_anchor_x + 2).min(image.width()) {
                for py in y + 5..(y + 13).min(row_bottom) {
                    image.put_pixel(px, py, Rgb([26, 115, 232]));
                }
            }

            let date_width = 10 + ((email_index * 5) % 4);
            for px in list_x + list_w.saturating_sub(26)
                ..(list_x + list_w.saturating_sub(26) + date_width).min(image.width())
            {
                for py in y + 7..(y + 10).min(row_bottom) {
                    image.put_pixel(px, py, Rgb([95, 99, 104]));
                }
            }
        }

        fn gmail_like_frame(scroll_y: u32) -> RgbImage {
            let width = 720;
            let height = 220;
            let top_bar_h = 34;
            let tabs_h = 26;
            let header_h = top_bar_h + tabs_h;
            let left_sidebar_w = 118;
            let list_x = left_sidebar_w + 26;
            let list_w = width - list_x - 24;
            let row_height = 18;
            let mut image = RgbImage::from_pixel(width, height, Rgb([248, 249, 250]));

            for y in 0..top_bar_h {
                for x in 0..width {
                    image.put_pixel(x, y, Rgb([241, 243, 244]));
                }
            }
            for y in top_bar_h..header_h {
                for x in list_x..(list_x + list_w).min(width) {
                    image.put_pixel(x, y, Rgb([255, 255, 255]));
                }
            }
            for x in list_x..(list_x + 136).min(width) {
                image.put_pixel(x, header_h - 1, Rgb([26, 115, 232]));
            }

            for y in 0..height {
                for x in 0..left_sidebar_w {
                    image.put_pixel(x, y, Rgb([248, 249, 250]));
                }
            }
            for item in 0..7u32 {
                let item_y = 72 + item * 22;
                if item_y + 16 >= height {
                    break;
                }
                for x in 16..(left_sidebar_w - 10) {
                    for y in item_y..item_y + 14 {
                        let shade = if item == 1 { 218 } else { 248 };
                        image.put_pixel(x, y, Rgb([shade, shade, shade]));
                    }
                }
            }

            let doc_row_count = 80u32;
            for viewport_y in header_h..height {
                let content_y = viewport_y - header_h;
                let doc_y = scroll_y + content_y;
                let email_index = (doc_y / row_height).min(doc_row_count - 1);
                let row_offset = doc_y % row_height;
                let row_top = viewport_y.saturating_sub(row_offset);
                draw_email_row(&mut image, row_top, row_height, list_x, list_w, email_index);
            }

            image
        }

        let previous = gmail_like_frame(0);
        let current = gmail_like_frame(36);

        let analysis = analyze_long_capture_pair_images(
            &previous,
            &current,
            LongCaptureAnalyzeOptions {
                axis: Some(LongCaptureAxis::Vertical),
                direction: Some(LongCaptureDirection::Down),
                max_scan: Some(180),
                min_overlap_px: Some(12),
                min_new_content_px: Some(8),
            },
        );

        assert_eq!(analysis.status, LongCaptureOverlapStatus::Good);
        assert_eq!(analysis.direction, Some(LongCaptureDirection::Down));
        assert_eq!(analysis.append_px, 36);
    }

    #[test]
    fn wide_board_prefers_horizontal_right_after_vertical_rows_fail() {
        fn draw_board_column(image: &mut RgbImage, x: u32, content_top: u32, doc_x: u32) {
            for y in content_top..image.height() {
                image.put_pixel(x, y, Rgb([255, 255, 255]));
            }

            if doc_x % 23 <= 2 {
                let top = content_top + 18 + ((doc_x * 7) % 36);
                for px in x..(x + 3).min(image.width()) {
                    for py in top..(top + 72).min(image.height()) {
                        image.put_pixel(px, py, Rgb([32, 33, 36]));
                    }
                }
            }

            if doc_x % 37 == 11 {
                let top = content_top + 8 + ((doc_x * 5) % 42);
                for px in x..(x + 5).min(image.width()) {
                    for py in top..(top + 24).min(image.height()) {
                        image.put_pixel(px, py, Rgb([26, 115, 232]));
                    }
                }
            }

            if doc_x % 19 == 3 {
                let top = content_top + 86 + ((doc_x * 3) % 28);
                for px in x..(x + 2).min(image.width()) {
                    for py in top..(top + 18).min(image.height()) {
                        image.put_pixel(px, py, Rgb([95, 99, 104]));
                    }
                }
            }
        }

        fn wide_board_frame(scroll_x: u32) -> RgbImage {
            let width = 260;
            let height = 180;
            let fixed_left_w = 40;
            let header_h = 28;
            let mut image = RgbImage::from_pixel(width, height, Rgb([248, 249, 250]));

            for y in 0..header_h {
                for x in 0..width {
                    image.put_pixel(x, y, Rgb([241, 243, 244]));
                }
            }

            for x in 0..fixed_left_w {
                for y in 0..height {
                    let shade = if (y / 18) % 2 == 0 { 247 } else { 235 };
                    image.put_pixel(x, y, Rgb([shade, shade, shade]));
                }
            }

            for viewport_x in fixed_left_w..width {
                let doc_x = scroll_x + viewport_x - fixed_left_w;
                draw_board_column(&mut image, viewport_x, header_h, doc_x);
            }

            image
        }

        let previous = wide_board_frame(0);
        let current = wide_board_frame(36);

        let analysis = analyze_long_capture_pair_images(
            &previous,
            &current,
            LongCaptureAnalyzeOptions {
                axis: None,
                direction: None,
                max_scan: Some(220),
                min_overlap_px: Some(12),
                min_new_content_px: Some(8),
            },
        );

        assert_eq!(analysis.status, LongCaptureOverlapStatus::Good);
        assert_eq!(analysis.axis, Some(LongCaptureAxis::Horizontal));
        assert_eq!(analysis.direction, Some(LongCaptureDirection::Right));
        assert_eq!(analysis.append_px, 36);
    }

    #[test]
    fn stitches_horizontal_frames_without_duplicate_overlap_columns() {
        let first = image_from_columns(
            2,
            &[[10, 0, 0], [20, 0, 0], [30, 0, 0], [40, 0, 0], [50, 0, 0]],
        );
        let second = image_from_columns(
            2,
            &[[30, 0, 0], [40, 0, 0], [50, 0, 0], [60, 0, 0], [70, 0, 0]],
        );

        let stitched = stitch_long_capture_frames(
            &[first, second],
            LongCaptureStitchOptions {
                axis: Some(LongCaptureAxis::Horizontal),
                direction: Some(LongCaptureDirection::Right),
                max_scan: Some(4),
                min_overlap_px: Some(1),
            },
        )
        .expect("horizontal stitch should succeed");

        assert_eq!(stitched.width(), 7);
        assert_eq!(stitched.height(), 2);
        assert_eq!(stitched.get_pixel(0, 0).0, [10, 0, 0]);
        assert_eq!(stitched.get_pixel(6, 0).0, [70, 0, 0]);
    }

    fn image_from_columns(height: u32, columns: &[[u8; 3]]) -> RgbImage {
        let mut img = RgbImage::new(columns.len() as u32, height);
        for (x, color) in columns.iter().enumerate() {
            for y in 0..height {
                img.put_pixel(x as u32, y, Rgb(*color));
            }
        }
        img
    }
}
