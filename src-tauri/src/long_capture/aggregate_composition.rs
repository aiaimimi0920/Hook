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
            let y = u32::try_from(local_start)
                .map_err(|_| anyhow!("Vertical long-capture crop start is too large"))?;
            let height = u32::try_from(len)
                .map_err(|_| anyhow!("Vertical long-capture crop length is too large"))?;
            if y.checked_add(height).filter(|end| *end <= image.height()).is_none() {
                return Err(anyhow!("Vertical long-capture crop is out of bounds"));
            }
            Ok(imageops::crop_imm(image, 0, y, image.width(), height).to_image())
        }
        LongCaptureAxis::Horizontal => {
            let x = u32::try_from(local_start)
                .map_err(|_| anyhow!("Horizontal long-capture crop start is too large"))?;
            let width = u32::try_from(len)
                .map_err(|_| anyhow!("Horizontal long-capture crop length is too large"))?;
            if x.checked_add(width).filter(|end| *end <= image.width()).is_none() {
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

fn checked_axis_segments_len(
    segments: &VecDeque<RgbImage>,
    axis: LongCaptureAxis,
) -> Result<u32> {
    segments.iter().try_fold(0u32, |total, segment| {
        total
            .checked_add(axis_segment_len(segment, axis))
            .ok_or_else(|| anyhow!("Long-capture aggregate axis length overflow"))
    })
}

fn concatenate_axis_segments(
    segments: &VecDeque<RgbImage>,
    axis: LongCaptureAxis,
) -> Result<RgbImage> {
    let Some(first) = segments.front() else {
        return Ok(RgbImage::new(0, 0));
    };
    let axis_len = checked_axis_segments_len(segments, axis)?;
    match axis {
        LongCaptureAxis::Vertical => {
            let width = first.width();
            validate_long_capture_output_dimensions(width, axis_len)?;
            let mut image = RgbImage::new(width, axis_len);
            let mut y = 0i64;
            for segment in segments {
                imageops::replace(&mut image, segment, 0, y);
                y = y
                    .checked_add(i64::from(segment.height()))
                    .ok_or_else(|| anyhow!("Long-capture vertical cursor overflow"))?;
            }
            Ok(image)
        }
        LongCaptureAxis::Horizontal => {
            let height = first.height();
            validate_long_capture_output_dimensions(axis_len, height)?;
            let mut image = RgbImage::new(axis_len, height);
            let mut x = 0i64;
            for segment in segments {
                imageops::replace(&mut image, segment, x, 0);
                x = x
                    .checked_add(i64::from(segment.width()))
                    .ok_or_else(|| anyhow!("Long-capture horizontal cursor overflow"))?;
            }
            Ok(image)
        }
    }
}

fn aggregate_to_image(aggregate: &LongCaptureAggregate, axis: LongCaptureAxis) -> Result<RgbImage> {
    if aggregate.segments.len() == 1 {
        let image = aggregate
            .segments
            .front()
            .cloned()
            .unwrap_or_else(|| RgbImage::new(0, 0));
        if image.width() > 0 && image.height() > 0 {
            validate_long_capture_output_dimensions(image.width(), image.height())?;
        }
        return Ok(image);
    }
    concatenate_axis_segments(&aggregate.segments, axis)
}

fn aggregate_into_image(mut aggregate: LongCaptureAggregate) -> Result<RgbImage> {
    if let Some(axis) = aggregate.axis {
        return concatenate_axis_segments(&aggregate.segments, axis);
    }
    let image = aggregate
        .segments
        .pop_front()
        .unwrap_or_else(|| RgbImage::new(0, 0));
    if image.width() > 0 && image.height() > 0 {
        validate_long_capture_output_dimensions(image.width(), image.height())?;
    }
    Ok(image)
}

fn aggregate_axis_len(aggregate: &LongCaptureAggregate, axis: LongCaptureAxis) -> Option<u32> {
    checked_axis_segments_len(&aggregate.segments, axis).ok()
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
    let current_axis_len = checked_axis_segments_len(&aggregate.segments, axis)?;
    let output_axis_len = current_axis_len
        .checked_add(axis_segment_len(&segment, axis))
        .ok_or_else(|| anyhow!("Long-capture aggregate axis length overflow"))?;
    let cross_len = axis_segment_cross_len(&segment, axis);
    match axis {
        LongCaptureAxis::Vertical => {
            validate_long_capture_output_dimensions(cross_len, output_axis_len)?
        }
        LongCaptureAxis::Horizontal => {
            validate_long_capture_output_dimensions(output_axis_len, cross_len)?
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
    if len == 0 || len > aggregate_axis_len(aggregate, axis)? {
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
