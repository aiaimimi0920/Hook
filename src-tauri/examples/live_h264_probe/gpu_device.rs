//! 探针专属硬件设备；编码器必须绑定同一 adapter，不使用 WARP 或软件回退。
use anyhow::{ensure, Context, Result};
use windows::{
    core::Interface,
    Win32::{
        Graphics::{Direct3D::D3D_DRIVER_TYPE_UNKNOWN, Direct3D11::*, Dxgi::*},
        Media::MediaFoundation::*,
    },
};

pub struct GpuDevice {
    pub device: ID3D11Device,
    pub context: ID3D11DeviceContext,
    pub manager: IMFDXGIDeviceManager,
    pub enumeration: IMFAttributes,
}

impl GpuDevice {
    pub fn create() -> Result<Self> {
        unsafe {
            let factory: IDXGIFactory1 = CreateDXGIFactory1()?;
            let mut selected = None;
            for index in 0..16 {
                let adapter = match factory.EnumAdapters1(index) {
                    Ok(adapter) => adapter,
                    Err(error) if error.code() == DXGI_ERROR_NOT_FOUND => break,
                    Err(error) => return Err(error.into()),
                };
                if adapter.GetDesc1()?.Flags & DXGI_ADAPTER_FLAG_SOFTWARE.0 as u32 == 0 {
                    selected = Some(adapter);
                    break;
                }
            }
            let adapter = selected.context("no hardware DXGI adapter")?;
            let luid = adapter.GetDesc1()?.AdapterLuid;
            let mut device = None;
            let mut context = None;
            D3D11CreateDevice(
                &adapter,
                D3D_DRIVER_TYPE_UNKNOWN,
                Default::default(),
                D3D11_CREATE_DEVICE_BGRA_SUPPORT | D3D11_CREATE_DEVICE_VIDEO_SUPPORT,
                None,
                D3D11_SDK_VERSION,
                Some(&mut device),
                None,
                Some(&mut context),
            )?;
            let device = device.context("D3D11 device missing")?;
            let context: ID3D11DeviceContext = context.context("D3D11 context missing")?;
            let multithread: ID3D11Multithread = context.cast()?;
            let _ = multithread.SetMultithreadProtected(true);
            ensure!(
                multithread.GetMultithreadProtected().as_bool(),
                "D3D11 multithread protection missing"
            );
            let mut token = 0;
            let mut manager = None;
            MFCreateDXGIDeviceManager(&mut token, &mut manager)?;
            let manager = manager.context("DXGI manager missing")?;
            manager.ResetDevice(&device, token)?;
            let mut enumeration = None;
            MFCreateAttributes(&mut enumeration, 1)?;
            let enumeration = enumeration.context("MFT enumeration attributes missing")?;
            enumeration.SetUINT64(
                &MFT_ENUM_ADAPTER_LUID,
                (u64::from(luid.HighPart as u32) << 32) | u64::from(luid.LowPart),
            )?;
            Ok(Self {
                device,
                context,
                manager,
                enumeration,
            })
        }
    }

    pub fn attach(&self, transform: &IMFTransform) -> Result<()> {
        unsafe {
            ensure!(
                transform.GetAttributes()?.GetUINT32(&MF_SA_D3D11_AWARE)? == 1,
                "hardware encoder is not D3D11 aware"
            );
            transform
                .ProcessMessage(MFT_MESSAGE_SET_D3D_MANAGER, self.manager.as_raw() as usize)?;
        }
        Ok(())
    }
}
