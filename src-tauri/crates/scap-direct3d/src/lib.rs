#![cfg(windows)]

mod capturer;
mod frame;
mod settings;
mod staging_pool;
mod windows_version;

pub use capturer::{Capturer, NewCapturerError, StopCapturerError};
pub use frame::{Frame, FrameBuffer};
pub use settings::{PixelFormat, Settings, is_supported};
pub use windows_version::WindowsVersion;
