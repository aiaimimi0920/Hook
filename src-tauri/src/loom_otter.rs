use base64::Engine as _;
use image::{ImageReader, Limits, RgbaImage};
use serde::{Deserialize, Serialize};
use shared_memory::ShmemConf;
use std::collections::HashMap;
use std::io::Cursor;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use uuid::Uuid;
mod listener_lifecycle;
use listener_lifecycle::ListenerTask;

// Responsibility-named lexical owners preserve the private protocol graph while
// keeping every Loom Otter source below the Phase 79 line limit.
include!("loom_otter/protocol_models.rs");
include!("loom_otter/state_diagnostics.rs");
include!("loom_otter/formal_delivery.rs");
include!("loom_otter/art_transport.rs");
include!("loom_otter/subscription_settings.rs");
include!("loom_otter/websocket_listener.rs");
include!("loom_otter/remote_surface_listener.rs");
include!("loom_otter/handshake.rs");
include!("loom_otter/action_dispatch.rs");
include!("loom_otter/surface_event.rs");
include!("loom_otter/surface_event_stream.rs");
include!("loom_otter/surface_attachment.rs");
include!("loom_otter/surface_control.rs");
include!("loom_otter/resource_transfer.rs");
include!("loom_otter/input_paths.rs");
include!("loom_otter/shader_inputs.rs");
include!("loom_otter/shader_runtime.rs");

#[cfg(test)]
mod loom_otter_listener_subscription_tests {
    include!("loom_otter/tests/support.rs");
    include!("loom_otter/tests/stream.rs");
    include!("loom_otter/tests/delivery.rs");
    include!("loom_otter/tests/hardening.rs");
    include!("loom_otter/tests/routing.rs");
    include!("loom_otter/tests/surface_event_stream.rs");
    include!("loom_otter/tests/surface_attachment.rs");
}

#[cfg(test)]
mod input_image_resolution {
    include!("loom_otter/tests/input_images.rs");
}
