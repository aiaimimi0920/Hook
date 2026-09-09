// Attach one Unit to either a shared window source or a private display capture.
enum ActiveProducer {
    Display(Capturer),
    Window(Option<shared::Subscription>),
}

impl ActiveProducer {
    fn stop(&mut self) {
        match self {
            Self::Display(capturer) => {
                let _ = capturer.stop();
            }
            Self::Window(subscription) => {
                drop(subscription.take());
            }
        }
    }
    fn set_interval(&mut self, interval: std::time::Duration) -> Result<(), String> {
        match self {
            Self::Display(capturer) => capturer
                .session()
                .SetMinUpdateInterval(interval.into())
                .map_err(|error| error.to_string()),
            Self::Window(subscription) => subscription
                .as_ref()
                .ok_or("shared subscription stopped")?
                .set_interval(interval),
        }
    }
}

fn build_active_capturer(
    config: &mut LiveCaptureWorkerConfig,
    mailbox: std::sync::Arc<FrameMailbox>,
    item_closed: std::sync::Arc<AtomicBool>,
) -> Result<(ActiveLiveCapturer, Option<u32>, Option<String>), LiveCaptureBuildError> {
    let source = build_capture_source(config)?;
    crate::live_resources::resize(
        &config.session_id,
        source_resource_cost(&source).map_err(LiveCaptureBuildError::Retry)?,
    )
    .map_err(LiveCaptureBuildError::Retry)?;
    let size = source
        .item
        .Size()
        .map_err(|error| LiveCaptureBuildError::Retry(format!("item size failed: {error:?}")))?;
    if size.Width <= 0 || size.Height <= 0 {
        return Err(LiveCaptureBuildError::Retry(
            "capture item is empty".to_string(),
        ));
    }
    let key = if let Some(window_id) = config.window_id.as_ref() {
        let process_id = source
            .process_id
            .ok_or(LiveCaptureBuildError::SourceClosed(
                "source process missing",
            ))?;
        Some(
            shared::SourceKey::new(window_id, process_id, size.Width, size.Height)
                .map_err(LiveCaptureBuildError::Retry)?,
        )
    } else {
        None
    };
    let output_pixels = source
        .crop
        .map_or(size.Width as u64 * size.Height as u64, |crop| {
            u64::from(crop.right - crop.left) * u64::from(crop.bottom - crop.top)
        });
    mailbox.budget.source_size(
        size.Width as u32,
        size.Height as u32,
        output_pixels,
        key.as_ref().map(shared::SourceKey::budget_key),
    );
    let interval = mailbox.budget.interval();
    let producer = if let Some(key) = key {
        let subscription = shared::subscribe(
            key,
            source.item.clone(),
            &config.session_id,
            mailbox,
            source.crop,
            item_closed,
            interval,
        )
        .map_err(LiveCaptureBuildError::Retry)?;
        ActiveProducer::Window(Some(subscription))
    } else {
        let mut settings = windows_capture_settings(source.crop);
        settings.fps = Some(u32::from(config.target_fps));
        settings.latest_frame_only = true;
        settings.min_update_interval = Some(interval);
        let callback_session = config.session_id.clone();
        let mut capturer = Capturer::new(
            source.item.clone(),
            settings,
            move |frame| {
                mailbox.capture(&callback_session, &frame, None);
                Ok(())
            },
            move || {
                item_closed.store(true, Ordering::Release);
                Ok(())
            },
            shared_d3d_device().ok().cloned(),
        )
        .map_err(|error| {
            LiveCaptureBuildError::Retry(format!("capturer create failed: {error:?}"))
        })?;
        capturer.start().map_err(|error| {
            LiveCaptureBuildError::Retry(format!("capturer start failed: {error:?}"))
        })?;
        ActiveProducer::Display(capturer)
    };
    Ok((
        ActiveLiveCapturer {
            producer,
            item: source.item,
            width: size.Width,
            height: size.Height,
            interval,
        },
        source.process_id,
        source.title,
    ))
}
