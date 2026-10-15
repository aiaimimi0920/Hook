// Activated lazily on the first viewfinder movement. Existing 1-D captures keep
// their original fast path. Empty canvas pixels remain transparent until export.
#[derive(Clone, Debug)]
struct SpatialCapture {
    canvas: image::RgbaImage,
    cursor: (i64, i64),
}

impl SpatialCapture {
    fn insert(&mut self, frame: &RgbImage, offset: (i64, i64)) -> Result<()> {
        let x = self.cursor.0 + offset.0;
        let y = self.cursor.1 + offset.1;
        let left = x.min(0);
        let top = y.min(0);
        let right = (x + i64::from(frame.width())).max(i64::from(self.canvas.width()));
        let bottom = (y + i64::from(frame.height())).max(i64::from(self.canvas.height()));
        let w = u32::try_from(right - left)?;
        let h = u32::try_from(bottom - top)?;
        validate_long_capture_output_dimensions(w, h)?;
        // RGBA plus resize transient allocation is bounded independently of RGB limits.
        if u64::from(w) * u64::from(h) > 64 * 1024 * 1024 {
            return Err(anyhow!("Spatial capture exceeds the 64-megapixel limit"));
        }
        if (w, h) != self.canvas.dimensions() {
            let mut expanded = image::RgbaImage::new(w, h);
            imageops::replace(&mut expanded, &self.canvas, -left, -top);
            self.canvas = expanded;
        }
        self.cursor = (x - left, y - top);
        for (fx, fy, pixel) in frame.enumerate_pixels() {
            let target = self
                .canvas
                .get_pixel_mut(self.cursor.0 as u32 + fx, self.cursor.1 as u32 + fy);
            // Preserve prior pixels in overlaps rather than overwriting earlier content.
            if target[3] == 0 {
                *target = image::Rgba([pixel[0], pixel[1], pixel[2], 255]);
            }
        }
        Ok(())
    }

    fn finish(self) -> Result<RgbImage> {
        let (x, y, w, h) = largest_covered_rectangle(&self.canvas);
        if w == 0 || h == 0 {
            return Err(anyhow!("No covered capture rectangle"));
        }
        Ok(RgbImage::from_fn(w, h, |px, py| {
            let p = self.canvas.get_pixel(x + px, y + py);
            image::Rgb([p[0], p[1], p[2]])
        }))
    }

    fn preview(&self) -> (image::RgbaImage, u32, u32) {
        let (w, h) = self.canvas.dimensions();
        let scale = (320.0 / w as f64).min(640.0 / h as f64).min(1.0);
        let pw = (w as f64 * scale).round().max(1.0) as u32;
        let ph = (h as f64 * scale).round().max(1.0) as u32;
        let preview = image::RgbaImage::from_fn(pw, ph, |x, y| {
            *self.canvas.get_pixel(
                (x as u64 * w as u64 / pw as u64) as u32,
                (y as u64 * h as u64 / ph as u64) as u32,
            )
        });
        (preview, w, h)
    }
}

impl LongCaptureIncrementalStitcher {
    pub(crate) fn preview_rgba(&self) -> (image::RgbaImage, u32, u32) {
        if let Some(spatial) = &self.spatial {
            return spatial.preview();
        }
        let (image, w, h) = self.preview_image();
        (image::DynamicImage::ImageRgb8(image).into_rgba8(), w, h)
    }

    pub(crate) fn push_frame_at(
        &mut self,
        current: RgbImage,
        movement: (i64, i64),
    ) -> Result<bool> {
        if self.spatial.is_none() && movement == (0, 0) {
            return self.push_frame_owned(current);
        }
        validate_long_capture_frame_dimensions(current.width(), current.height())?;
        validate_long_capture_frame_count(self.frame_count + 1)?;
        let offset =
            spatial_frame_offset(&self.spatial_reference, &current, movement, self.options)?;
        if self.spatial.is_none() {
            let aggregate = aggregate_to_image(
                &self.aggregate,
                self.axis().unwrap_or(LongCaptureAxis::Vertical),
            )?;
            // Keep the matcher's exact coordinate where available, especially for
            // repeated page sections. Only covered revisits need an anchor search.
            let cursor = if let Some(origin) = self.spatial_reference_origin {
                let position = origin - self.aggregate.origin;
                if self.axis() == Some(LongCaptureAxis::Horizontal) {
                    (position, 0)
                } else {
                    (0, position)
                }
            } else {
                locate_spatial_reference(&aggregate, &self.spatial_reference, self.axis())?
            };
            if u64::from(aggregate.width()) * u64::from(aggregate.height()) > 64 * 1024 * 1024 {
                return Err(anyhow!("Spatial capture exceeds the 64-megapixel limit"));
            }
            let mut spatial = SpatialCapture {
                canvas: image::DynamicImage::ImageRgb8(aggregate).into_rgba8(),
                cursor,
            };
            spatial.insert(&current, offset)?;
            self.spatial = Some(spatial);
            // The RGBA canvas now owns all old pixels; do not retain a second aggregate.
            self.aggregate.segments.clear();
            self.aggregate.signatures = None;
        } else {
            self.spatial.as_mut().unwrap().insert(&current, offset)?;
        }
        self.spatial_reference = current;
        self.frame_count += 1;
        self.merged_frames += 1;
        Ok(true)
    }
}
