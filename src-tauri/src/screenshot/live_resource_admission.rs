// Resource preflight creates only the capture item, never a WGC pool or worker.
fn source_resource_cost(
    source: &BuiltCaptureSource,
) -> Result<crate::live_resources::Cost, String> {
    let size = source.item.Size().map_err(|_| "live_resource_dimensions")?;
    let width = u32::try_from(size.Width).map_err(|_| "live_resource_dimensions")?;
    let height = u32::try_from(size.Height).map_err(|_| "live_resource_dimensions")?;
    let pixels = u64::from(width) * u64::from(height);
    if source.crop.is_some_and(|crop| {
        crop.left >= crop.right
            || crop.top >= crop.bottom
            || crop.right > width
            || crop.bottom > height
    }) {
        return Err("live_resource_dimensions".to_string());
    }
    let crop = source.crop.map_or(pixels, |crop| {
        u64::from(crop.right.saturating_sub(crop.left))
            * u64::from(crop.bottom.saturating_sub(crop.top))
    });
    crate::live_resources::Cost::new(pixels, crop).map_err(str::to_string)
}

fn reserve_live_source(
    config: &mut LiveCaptureWorkerConfig,
) -> Result<crate::live_resources::Reservation, String> {
    let source = build_capture_source(config).map_err(|error| match error {
        LiveCaptureBuildError::SourceClosed(detail) => detail.to_string(),
        LiveCaptureBuildError::Retry(detail) => detail,
    })?;
    if let Ok(device) = shared_d3d_device() {
        crate::live_resources::set_device(device);
    }
    crate::live_resources::reserve(&config.session_id, source_resource_cost(&source)?)
}
