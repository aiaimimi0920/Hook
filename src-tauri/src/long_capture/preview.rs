// Samples the exact aggregate without flattening or copying the full-size result.
impl LongCaptureIncrementalStitcher {
    pub(crate) fn preview_image(&self) -> (RgbImage, u32, u32) {
        let vertical = self.aggregate.axis != Some(LongCaptureAxis::Horizontal);
        let first = self
            .aggregate
            .segments
            .front()
            .expect("aggregate has a first frame");
        let length: u32 = self
            .aggregate
            .segments
            .iter()
            .map(|s| if vertical { s.height() } else { s.width() })
            .sum();
        let (width, height) = if vertical {
            (first.width(), length)
        } else {
            (length, first.height())
        };
        let scale = (320.0_f64 / width as f64)
            .min(640.0 / height as f64)
            .min(1.0);
        let w = (width as f64 * scale).round().max(1.0) as u32;
        let h = (height as f64 * scale).round().max(1.0) as u32;
        let mut output = RgbImage::new(w, h);
        let mut segments = self.aggregate.segments.iter();
        let mut segment = segments.next().unwrap();
        let mut offset = 0;
        // Traverse along the aggregate axis so each source segment is visited once.
        for along in 0..if vertical { h } else { w } {
            let source =
                (along as u64 * length as u64 / if vertical { h } else { w } as u64) as u32;
            while source
                >= offset
                    + if vertical {
                        segment.height()
                    } else {
                        segment.width()
                    }
            {
                offset += if vertical {
                    segment.height()
                } else {
                    segment.width()
                };
                segment = segments.next().unwrap();
            }
            for cross in 0..if vertical { w } else { h } {
                let (x, y, sx, sy) = if vertical {
                    (
                        cross,
                        along,
                        (cross as u64 * width as u64 / w as u64) as u32,
                        source - offset,
                    )
                } else {
                    (
                        along,
                        cross,
                        source - offset,
                        (cross as u64 * height as u64 / h as u64) as u32,
                    )
                };
                output.put_pixel(x, y, *segment.get_pixel(sx, sy));
            }
        }
        (output, width, height)
    }
}
