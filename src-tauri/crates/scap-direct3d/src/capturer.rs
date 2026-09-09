//! Windows Graphics Capture session creation and callback lifecycle.

use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};

use windows::{
    Foundation::{Metadata::ApiInformation, TypedEventHandler},
    Graphics::{
        Capture::{Direct3D11CaptureFramePool, GraphicsCaptureItem, GraphicsCaptureSession},
        DirectX::Direct3D11::IDirect3DDevice,
    },
    Win32::{
        Foundation::{E_POINTER, HMODULE},
        Graphics::{
            Direct3D::{D3D_DRIVER_TYPE, D3D_DRIVER_TYPE_HARDWARE, D3D_DRIVER_TYPE_WARP},
            Direct3D11::{
                D3D11_BIND_RENDER_TARGET, D3D11_BIND_SHADER_RESOURCE, D3D11_BOX,
                D3D11_CREATE_DEVICE_FLAG, D3D11_SDK_VERSION, D3D11_TEXTURE2D_DESC,
                D3D11_USAGE_DEFAULT, D3D11CreateDevice, ID3D11Device, ID3D11DeviceContext,
                ID3D11Texture2D,
            },
            Dxgi::{Common::DXGI_SAMPLE_DESC, DXGI_ERROR_UNSUPPORTED, IDXGIDevice},
        },
        System::WinRT::Direct3D11::{
            CreateDirect3D11DeviceFromDXGIDevice, IDirect3DDxgiInterfaceAccess,
        },
    },
    core::{Error, HSTRING, IInspectable, Interface},
};

use crate::frame_selection::{next_frame, pool_size};
use crate::{Frame, Settings, WindowsVersion, staging_pool::StagingTexturePool};

#[derive(Clone, Debug, thiserror::Error)]
pub enum NewCapturerError {
    #[error("Screen capture requires Windows 10 version 1903 (build 18362) or later")]
    WindowsVersionTooOld,
    #[error(
        "Windows Graphics Capture API is disabled or unavailable. This may be due to group policy or missing system components."
    )]
    GraphicsCaptureDisabled,
    #[error("NotSupported")]
    NotSupported,
    #[error("BorderNotSupported")]
    BorderNotSupported,
    #[error("CursorNotSupported")]
    CursorNotSupported,
    #[error("UpdateIntervalNotSupported")]
    UpdateIntervalNotSupported,
    #[error("CreateDevice: {0}")]
    CreateDevice(windows::core::Error),
    #[error("CreateDevice returned no device")]
    MissingDevice,
    #[error("CreateDevice: {0}")]
    Context(windows::core::Error),
    #[error("Direct3DDevice: {0}")]
    Direct3DDevice(windows::core::Error),
    #[error("CreateDevice: {0}")]
    ItemSize(windows::core::Error),
    #[error("invalid capture item size {width}x{height}")]
    InvalidItemSize { width: i32, height: i32 },
    #[error("invalid crop: {0}")]
    InvalidCrop(String),
    #[error("FramePool: {0}")]
    FramePool(windows::core::Error),
    #[error("CaptureSession: {0}")]
    CaptureSession(windows::core::Error),
    #[error("CropTexture: {0}")]
    CropTexture(windows::core::Error),
    #[error("CropTexture returned no texture")]
    MissingCropTexture,
    #[error("RegisterFrameArrived: {0}")]
    RegisterFrameArrived(windows::core::Error),
    #[error("RegisterClosed: {0}")]
    RegisterClosed(windows::core::Error),
    #[error("RecvTimeout")]
    RecvTimeout(#[from] std::sync::mpsc::RecvError),
    #[error("Other: {0}")]
    Other(#[from] windows::core::Error),
}

pub struct Capturer {
    settings: Settings,
    d3d_device: ID3D11Device,
    d3d_context: ID3D11DeviceContext,
    session: GraphicsCaptureSession,
    item: GraphicsCaptureItem,
    item_closed_token: i64,
    frame_pool: Direct3D11CaptureFramePool,
    frame_arrived_token: i64,
    stop_flag: Arc<AtomicBool>,
    is_using_warp: bool,
}

impl Capturer {
    pub fn new(
        item: GraphicsCaptureItem,
        settings: Settings,
        callback: impl FnMut(Frame) -> windows::core::Result<()> + Send + 'static,
        mut closed_callback: impl FnMut() -> windows::core::Result<()> + Send + 'static,
        d3d_device: Option<ID3D11Device>,
    ) -> Result<Capturer, NewCapturerError> {
        crate::runtime::ensure_runtime()?;
        validate_platform_support()?;
        validate_requested_features(&settings)?;

        let (d3d_device, is_using_warp) = if let Some(device) = d3d_device {
            (device, false)
        } else {
            create_d3d_device_with_warp_fallback()?
        };
        let d3d_context =
            unsafe { d3d_device.GetImmediateContext() }.map_err(NewCapturerError::Context)?;
        let staging_pool = Arc::new(StagingTexturePool::new(
            d3d_device.clone(),
            settings.pixel_format,
        ));

        let item = item.clone();
        let settings = settings.clone();
        let stop_flag = Arc::new(AtomicBool::new(false));
        let direct3d_device = create_direct3d_device(&d3d_device)?;
        let item_size = item.Size().map_err(NewCapturerError::ItemSize)?;
        if item_size.Width <= 0 || item_size.Height <= 0 {
            return Err(NewCapturerError::InvalidItemSize {
                width: item_size.Width,
                height: item_size.Height,
            });
        }
        let crop_dimensions = settings
            .crop
            .map(|crop| validate_crop(crop, item_size.Width, item_size.Height))
            .transpose()?;
        let frame_pool_size = pool_size(settings.latest_frame_only, settings.fps);
        let frame_pool = Direct3D11CaptureFramePool::CreateFreeThreaded(
            &direct3d_device,
            settings.pixel_format.as_directx(),
            frame_pool_size,
            item_size,
        )
        .map_err(NewCapturerError::FramePool)?;
        let session = frame_pool
            .CreateCaptureSession(&item)
            .map_err(NewCapturerError::CaptureSession)?;
        configure_session(&session, &settings)?;

        let crop_data = settings
            .crop
            .zip(crop_dimensions)
            .map(|(crop, dimensions)| create_crop_texture(&d3d_device, &settings, crop, dimensions))
            .transpose()?;
        let frame_arrived_token = register_frame_callback(
            &frame_pool,
            &settings,
            &d3d_device,
            &d3d_context,
            &stop_flag,
            &staging_pool,
            crop_data,
            callback,
        )?;
        let item_closed_token = match item.Closed(&TypedEventHandler::<
            GraphicsCaptureItem,
            IInspectable,
        >::new(move |_, _| closed_callback()))
        {
            Ok(token) => token,
            Err(error) => {
                let _ = frame_pool.RemoveFrameArrived(frame_arrived_token);
                let _ = session.Close();
                let _ = frame_pool.Close();
                return Err(NewCapturerError::RegisterClosed(error));
            }
        };

        if is_using_warp {
            tracing::warn!(
                "Hardware GPU unavailable, using WARP software rasterizer for screen capture"
            );
        }
        Ok(Capturer {
            settings,
            d3d_device,
            d3d_context,
            session,
            item,
            item_closed_token,
            frame_pool,
            frame_arrived_token,
            stop_flag,
            is_using_warp,
        })
    }

    pub fn is_using_software_rendering(&self) -> bool {
        self.is_using_warp
    }

    pub fn settings(&self) -> &Settings {
        &self.settings
    }

    pub fn session(&self) -> &GraphicsCaptureSession {
        &self.session
    }

    pub fn d3d_device(&self) -> &ID3D11Device {
        &self.d3d_device
    }

    pub fn d3d_context(&self) -> &ID3D11DeviceContext {
        &self.d3d_context
    }

    pub fn start(&mut self) -> windows::core::Result<()> {
        self.session.StartCapture()
    }

    pub fn stop(&mut self) -> windows::core::Result<()> {
        if self.stop_flag.swap(true, Ordering::SeqCst) {
            return Ok(());
        }
        let _ = self.item.RemoveClosed(self.item_closed_token);
        let _ = self.frame_pool.RemoveFrameArrived(self.frame_arrived_token);
        let _ = self.session.Close();
        self.frame_pool.Close()
    }
}

impl Drop for Capturer {
    fn drop(&mut self) {
        let _ = self.stop();
    }
}

#[derive(Clone, Debug, thiserror::Error)]
pub enum StopCapturerError {
    #[error("NotStarted")]
    NotStarted,
    #[error("PostMessageFailed")]
    PostMessageFailed,
    #[error("ThreadJoinFailed")]
    ThreadJoinFailed,
}

#[derive(Clone)]
struct CropData {
    texture: ID3D11Texture2D,
    crop: D3D11_BOX,
    width: u32,
    height: u32,
}

fn validate_platform_support() -> Result<(), NewCapturerError> {
    if let Some(version) = WindowsVersion::detect() {
        tracing::debug!(
            version = %version.display_name(),
            meets_requirements = version.meets_minimum_requirements(),
            "Initializing screen capture"
        );
        if !version.meets_minimum_requirements() {
            return Err(NewCapturerError::WindowsVersionTooOld);
        }
    }
    let api_present = ApiInformation::IsApiContractPresentByMajor(
        &HSTRING::from("Windows.Foundation.UniversalApiContract"),
        8,
    )
    .unwrap_or(false);
    if !api_present {
        return Err(NewCapturerError::WindowsVersionTooOld);
    }
    if !GraphicsCaptureSession::IsSupported().unwrap_or(false) {
        return Err(NewCapturerError::GraphicsCaptureDisabled);
    }
    Ok(())
}

fn validate_requested_features(settings: &Settings) -> Result<(), NewCapturerError> {
    if settings.is_border_required.is_some() && !Settings::can_is_border_required()? {
        return Err(NewCapturerError::BorderNotSupported);
    }
    if settings.is_cursor_capture_enabled.is_some() && !Settings::can_is_cursor_capture_enabled()? {
        return Err(NewCapturerError::CursorNotSupported);
    }
    if settings.min_update_interval.is_some() && !Settings::can_min_update_interval()? {
        return Err(NewCapturerError::UpdateIntervalNotSupported);
    }
    Ok(())
}

fn create_d3d_device_with_type(
    driver_type: D3D_DRIVER_TYPE,
    device: *mut Option<ID3D11Device>,
) -> windows::core::Result<()> {
    unsafe {
        D3D11CreateDevice(
            None,
            driver_type,
            HMODULE::default(),
            D3D11_CREATE_DEVICE_FLAG::default(),
            None,
            D3D11_SDK_VERSION,
            Some(device),
            None,
            None,
        )
    }
}

fn create_d3d_device_with_warp_fallback() -> Result<(ID3D11Device, bool), NewCapturerError> {
    let mut device = None;
    match create_d3d_device_with_type(D3D_DRIVER_TYPE_HARDWARE, &mut device) {
        Ok(()) => Ok((device.ok_or(NewCapturerError::MissingDevice)?, false)),
        Err(error) if error.code() == DXGI_ERROR_UNSUPPORTED => {
            tracing::info!("Hardware D3D11 device unavailable, attempting WARP fallback");
            create_d3d_device_with_type(D3D_DRIVER_TYPE_WARP, &mut device)
                .map_err(NewCapturerError::CreateDevice)?;
            Ok((device.ok_or(NewCapturerError::MissingDevice)?, true))
        }
        Err(error) => Err(NewCapturerError::CreateDevice(error)),
    }
}

fn create_direct3d_device(d3d_device: &ID3D11Device) -> Result<IDirect3DDevice, NewCapturerError> {
    (|| {
        let dxgi_device = d3d_device.cast::<IDXGIDevice>()?;
        let inspectable = unsafe { CreateDirect3D11DeviceFromDXGIDevice(&dxgi_device) }?;
        inspectable.cast::<IDirect3DDevice>()
    })()
    .map_err(NewCapturerError::Direct3DDevice)
}

fn configure_session(
    session: &GraphicsCaptureSession,
    settings: &Settings,
) -> Result<(), NewCapturerError> {
    if let Some(border_required) = settings.is_border_required {
        session.SetIsBorderRequired(border_required)?;
    }
    if let Some(cursor_capture_enabled) = settings.is_cursor_capture_enabled {
        session.SetIsCursorCaptureEnabled(cursor_capture_enabled)?;
    }
    if let Some(min_update_interval) = settings.min_update_interval {
        session.SetMinUpdateInterval(min_update_interval.into())?;
    }
    Ok(())
}

fn validate_crop(
    crop: D3D11_BOX,
    item_width: i32,
    item_height: i32,
) -> Result<(u32, u32), NewCapturerError> {
    if crop.left >= crop.right || crop.top >= crop.bottom {
        return Err(NewCapturerError::InvalidCrop(
            "crop must have positive width and height".to_owned(),
        ));
    }
    if crop.front != 0 || crop.back != 1 {
        return Err(NewCapturerError::InvalidCrop(
            "2D crop depth must be 0..1".to_owned(),
        ));
    }
    if item_width <= 0
        || item_height <= 0
        || crop.right > item_width as u32
        || crop.bottom > item_height as u32
    {
        return Err(NewCapturerError::InvalidCrop(
            "crop exceeds the capture item bounds".to_owned(),
        ));
    }
    Ok((crop.right - crop.left, crop.bottom - crop.top))
}

fn create_crop_texture(
    d3d_device: &ID3D11Device,
    settings: &Settings,
    crop: D3D11_BOX,
    (width, height): (u32, u32),
) -> Result<CropData, NewCapturerError> {
    let desc = D3D11_TEXTURE2D_DESC {
        Width: width,
        Height: height,
        MipLevels: 1,
        ArraySize: 1,
        Format: settings.pixel_format.as_dxgi(),
        SampleDesc: DXGI_SAMPLE_DESC {
            Count: 1,
            Quality: 0,
        },
        Usage: D3D11_USAGE_DEFAULT,
        BindFlags: (D3D11_BIND_RENDER_TARGET.0 | D3D11_BIND_SHADER_RESOURCE.0) as u32,
        CPUAccessFlags: 0,
        MiscFlags: 0,
    };
    let mut texture = None;
    unsafe { d3d_device.CreateTexture2D(&desc, None, Some(&mut texture)) }
        .map_err(NewCapturerError::CropTexture)?;
    Ok(CropData {
        texture: texture.ok_or(NewCapturerError::MissingCropTexture)?,
        crop,
        width,
        height,
    })
}

fn register_frame_callback(
    frame_pool: &Direct3D11CaptureFramePool,
    settings: &Settings,
    d3d_device: &ID3D11Device,
    d3d_context: &ID3D11DeviceContext,
    stop_flag: &Arc<AtomicBool>,
    staging_pool: &Arc<StagingTexturePool>,
    crop_data: Option<CropData>,
    mut callback: impl FnMut(Frame) -> windows::core::Result<()> + Send + 'static,
) -> Result<i64, NewCapturerError> {
    let d3d_context = d3d_context.clone();
    let d3d_device = d3d_device.clone();
    let stop_flag = stop_flag.clone();
    let staging_pool = staging_pool.clone();
    let pixel_format = settings.pixel_format;
    let latest_frame_only = settings.latest_frame_only;
    frame_pool
        .FrameArrived(
            &TypedEventHandler::<Direct3D11CaptureFramePool, IInspectable>::new(
                move |frame_pool, _| {
                    if stop_flag.load(Ordering::Relaxed) {
                        return Ok(());
                    }
                    let frame_pool = frame_pool
                        .as_ref()
                        .ok_or_else(|| Error::new(E_POINTER, "FrameArrived parameter was None"))?;
                    let Some(frame) = next_frame(frame_pool, latest_frame_only)? else {
                        return Ok(());
                    };
                    let size = frame.ContentSize()?;
                    if size.Width <= 0 || size.Height <= 0 {
                        return Ok(());
                    }
                    let surface = frame.Surface()?;
                    let dxgi_interface = surface.cast::<IDirect3DDxgiInterfaceAccess>()?;
                    let texture = unsafe { dxgi_interface.GetInterface::<ID3D11Texture2D>() }?;
                    let frame = if let Some(crop) = crop_data.clone() {
                        if crop.crop.right > size.Width as u32
                            || crop.crop.bottom > size.Height as u32
                        {
                            return Ok(());
                        }
                        unsafe {
                            d3d_context.CopySubresourceRegion(
                                &crop.texture,
                                0,
                                0,
                                0,
                                0,
                                &texture,
                                0,
                                Some(&crop.crop),
                            );
                        }
                        Frame {
                            width: crop.width,
                            height: crop.height,
                            pixel_format,
                            inner: frame,
                            texture: crop.texture,
                            d3d_context: d3d_context.clone(),
                            d3d_device: d3d_device.clone(),
                            staging_pool: staging_pool.clone(),
                        }
                    } else {
                        Frame {
                            width: size.Width as u32,
                            height: size.Height as u32,
                            pixel_format,
                            inner: frame,
                            texture,
                            d3d_context: d3d_context.clone(),
                            d3d_device: d3d_device.clone(),
                            staging_pool: staging_pool.clone(),
                        }
                    };
                    callback(frame)
                },
            ),
        )
        .map_err(NewCapturerError::RegisterFrameArrived)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn crop(left: u32, top: u32, right: u32, bottom: u32) -> D3D11_BOX {
        D3D11_BOX {
            left,
            top,
            front: 0,
            right,
            bottom,
            back: 1,
        }
    }

    #[test]
    fn crop_validation_requires_positive_in_bounds_2d_region() {
        assert_eq!(
            validate_crop(crop(1, 2, 11, 22), 100, 100).unwrap(),
            (10, 20)
        );
        assert!(validate_crop(crop(5, 2, 5, 22), 100, 100).is_err());
        assert!(validate_crop(crop(1, 2, 101, 22), 100, 100).is_err());
        let mut invalid_depth = crop(1, 2, 11, 22);
        invalid_depth.back = 2;
        assert!(validate_crop(invalid_depth, 100, 100).is_err());
    }
}
