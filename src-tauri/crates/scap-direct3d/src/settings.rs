//! Capture pixel format, feature probes, and caller-controlled settings.

use std::time::Duration;

use windows::{
    Foundation::Metadata::ApiInformation,
    Graphics::{Capture::GraphicsCaptureSession, DirectX::DirectXPixelFormat},
    Win32::Graphics::{
        Direct3D11::D3D11_BOX,
        Dxgi::Common::{
            DXGI_FORMAT, DXGI_FORMAT_B8G8R8A8_UNORM, DXGI_FORMAT_R8G8B8A8_UNORM,
            DXGI_FORMAT_R16G16B16A16_FLOAT,
        },
    },
    core::HSTRING,
};

#[derive(Default, Clone, Copy, Debug, Eq, PartialEq)]
#[repr(i32)]
pub enum PixelFormat {
    #[default]
    R8G8B8A8Unorm,
    B8G8R8A8Unorm,
    R16G16B16A16Float,
}

impl PixelFormat {
    pub fn as_directx(&self) -> DirectXPixelFormat {
        match self {
            Self::R8G8B8A8Unorm => DirectXPixelFormat::R8G8B8A8UIntNormalized,
            Self::B8G8R8A8Unorm => DirectXPixelFormat::B8G8R8A8UIntNormalized,
            Self::R16G16B16A16Float => DirectXPixelFormat::R16G16B16A16Float,
        }
    }

    pub fn as_dxgi(&self) -> DXGI_FORMAT {
        match self {
            Self::R8G8B8A8Unorm => DXGI_FORMAT_R8G8B8A8_UNORM,
            Self::B8G8R8A8Unorm => DXGI_FORMAT_B8G8R8A8_UNORM,
            Self::R16G16B16A16Float => DXGI_FORMAT_R16G16B16A16_FLOAT,
        }
    }

    pub(crate) fn bytes_per_pixel(self) -> u32 {
        match self {
            Self::R8G8B8A8Unorm | Self::B8G8R8A8Unorm => 4,
            Self::R16G16B16A16Float => 8,
        }
    }
}

#[derive(Clone, Default, Debug)]
pub struct Settings {
    pub is_border_required: Option<bool>,
    pub is_cursor_capture_enabled: Option<bool>,
    pub min_update_interval: Option<Duration>,
    pub pixel_format: PixelFormat,
    pub crop: Option<D3D11_BOX>,
    pub fps: Option<u32>,
}

impl Settings {
    pub fn can_is_border_required() -> windows::core::Result<bool> {
        ApiInformation::IsPropertyPresent(
            &HSTRING::from("Windows.Graphics.Capture.GraphicsCaptureSession"),
            &HSTRING::from("IsBorderRequired"),
        )
    }

    pub fn can_is_cursor_capture_enabled() -> windows::core::Result<bool> {
        ApiInformation::IsPropertyPresent(
            &HSTRING::from("Windows.Graphics.Capture.GraphicsCaptureSession"),
            &HSTRING::from("IsCursorCaptureEnabled"),
        )
    }

    pub fn can_min_update_interval() -> windows::core::Result<bool> {
        ApiInformation::IsPropertyPresent(
            &HSTRING::from("Windows.Graphics.Capture.GraphicsCaptureSession"),
            &HSTRING::from("MinUpdateInterval"),
        )
    }
}

pub fn is_supported() -> windows::core::Result<bool> {
    Ok(ApiInformation::IsApiContractPresentByMajor(
        &HSTRING::from("Windows.Foundation.UniversalApiContract"),
        8,
    )? && GraphicsCaptureSession::IsSupported()?)
}
