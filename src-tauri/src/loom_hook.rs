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

// Responsibility-named lexical owners preserve the private protocol graph while
// keeping every Loom Hook source below the Phase 79 line limit.
include!("loom_hook/protocol_models.rs");
include!("loom_hook/state_diagnostics.rs");
include!("loom_hook/formal_delivery.rs");
include!("loom_hook/art_transport.rs");
include!("loom_hook/subscription_settings.rs");
include!("loom_hook/websocket_listener.rs");
include!("loom_hook/remote_surface_listener.rs");
include!("loom_hook/handshake.rs");
include!("loom_hook/action_dispatch.rs");
include!("loom_hook/surface_event.rs");
include!("loom_hook/surface_attachment.rs");
include!("loom_hook/surface_control.rs");
include!("loom_hook/resource_transfer.rs");
include!("loom_hook/input_paths.rs");
include!("loom_hook/shader_inputs.rs");
include!("loom_hook/shader_runtime.rs");

#[cfg(test)]
mod loom_hook_listener_subscription_tests {
    include!("loom_hook/tests/support.rs");
    include!("loom_hook/tests/stream.rs");
    include!("loom_hook/tests/delivery.rs");
    include!("loom_hook/tests/hardening.rs");
    include!("loom_hook/tests/routing.rs");
}

#[cfg(test)]
mod input_image_resolution {
    include!("loom_hook/tests/input_images.rs");
}
