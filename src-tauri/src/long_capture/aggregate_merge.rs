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
        aggregate.origin = aggregate
            .origin
            .checked_sub(matched.prepend_px)
            .ok_or_else(|| anyhow!("Long-capture aggregate origin overflow"))?;
    }

    if matched.append_px > 0 {
        let current_axis_len = frame_axis_len(current, axis);
        let crop_start = current_axis_len - matched.append_px;
        let crop = aggregate_crop_axis_segment(current, axis, crop_start, matched.append_px)?;
        push_aggregate_segment(aggregate, crop, axis, false)?;
    }

    let merged_signatures = previous_signatures
        .as_ref()
        .and_then(|signatures| merge_axis_signature_lists(signatures, &candidate.current_signatures, matched));
    aggregate.signatures = if let Some(signatures) = merged_signatures {
        Some(signatures)
    } else {
        let aggregate_image = aggregate_to_image(aggregate, axis)?;
        Some(axis_signature_list(&aggregate_image, axis))
    };
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
        validate_long_capture_frame_dimensions(current.width(), current.height())?;
        if self.frame_count >= MAX_LONG_CAPTURE_FRAME_COUNT {
            return Err(anyhow!(
                "Long-capture frame count exceeds the limit of {MAX_LONG_CAPTURE_FRAME_COUNT}"
            ));
        }
        let frame_index = self.frame_count;
        self.frame_count = self
            .frame_count
            .checked_add(1)
            .ok_or_else(|| anyhow!("Long-capture frame count overflow"))?;

        let mut best: Option<(LongCaptureAxis, AggregateMatchCandidate)> = None;
        for &axis in aggregate_axes_to_try(self.aggregate.axis) {
            if self.aggregate.axis.is_none() {
                let aggregate_image = aggregate_to_image(&self.aggregate, axis)?;
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
            let aggregate_image = aggregate_to_image(&self.aggregate, axis)?;
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

    fn finish_result(self) -> Result<LongCaptureAggregateResult> {
        let axis = self.aggregate.axis;
        Ok(LongCaptureAggregateResult {
            image: aggregate_into_image(self.aggregate)?,
            axis,
            merged_frames: self.merged_frames,
            skipped_frames: self.skipped_frames,
        })
    }

    fn try_into_image(self) -> Result<RgbImage> {
        aggregate_into_image(self.aggregate)
    }

    pub fn into_image(self) -> RgbImage {
        // The session API is currently infallible. Push-time budgets guarantee
        // flattening for multi-segment aggregates; retain a safe empty fallback
        // for an unexpected invariant violation instead of panicking.
        self.try_into_image().unwrap_or_else(|error| {
            crate::append_runtime_log_line(&format!(
                "long_capture aggregate_flatten_failed :: error={error}"
            ));
            RgbImage::new(0, 0)
        })
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
