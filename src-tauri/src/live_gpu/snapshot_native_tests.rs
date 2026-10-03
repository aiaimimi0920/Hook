//! Static readback must progress without WGC, Present, or another context producer.

use super::{GpuFrame, Readback};
use windows::Win32::Foundation::HMODULE;
use windows::Win32::Graphics::Direct3D::D3D_DRIVER_TYPE_HARDWARE;
use windows::Win32::Graphics::Direct3D11::{
    D3D11CreateDevice, D3D11_BIND_SHADER_RESOURCE, D3D11_CREATE_DEVICE_BGRA_SUPPORT,
    D3D11_SDK_VERSION, D3D11_SUBRESOURCE_DATA, D3D11_TEXTURE2D_DESC, D3D11_USAGE_DEFAULT,
};
use windows::Win32::Graphics::Dxgi::Common::{DXGI_FORMAT_B8G8R8A8_UNORM, DXGI_SAMPLE_DESC};

#[test]
#[ignore = "Windows hardware GPU: isolated texture readback, no app windows or input"]
fn static_staging_copy_progresses_without_other_gpu_work() {
    let (mut device, mut context) = (None, None);
    unsafe {
        D3D11CreateDevice(
            None,
            D3D_DRIVER_TYPE_HARDWARE,
            HMODULE::default(),
            D3D11_CREATE_DEVICE_BGRA_SUPPORT,
            None,
            D3D11_SDK_VERSION,
            Some(&mut device),
            None,
            Some(&mut context),
        )
    }
    .expect("isolated hardware device");
    let device = device.expect("hardware device");
    let context = context.expect("immediate context");
    let desc = D3D11_TEXTURE2D_DESC {
        Width: 32,
        Height: 16,
        MipLevels: 1,
        ArraySize: 1,
        Format: DXGI_FORMAT_B8G8R8A8_UNORM,
        SampleDesc: DXGI_SAMPLE_DESC {
            Count: 1,
            Quality: 0,
        },
        Usage: D3D11_USAGE_DEFAULT,
        BindFlags: D3D11_BIND_SHADER_RESOURCE.0 as u32,
        ..Default::default()
    };
    let pixels: Vec<u8> = [0, 255, 0, 255]
        .into_iter()
        .cycle()
        .take(32 * 16 * 4)
        .collect();
    let initial = D3D11_SUBRESOURCE_DATA {
        pSysMem: pixels.as_ptr().cast(),
        SysMemPitch: 32 * 4,
        SysMemSlicePitch: 0,
    };
    let mut texture = None;
    unsafe { device.CreateTexture2D(&desc, Some(&initial), Some(&mut texture)) }
        .expect("initialized source texture");
    let frame = GpuFrame {
        copy_id: 1,
        texture: texture.expect("source texture"),
        device,
        context,
        width: 32,
        height: 16,
        captured_at_ms: 123,
    };
    for _ in 0..8 {
        // No other work is submitted between this CopyResource and its nonblocking Map.
        let (image, captured_at_ms) = Readback::copy(&frame)
            .expect("independent staging copy")
            .into_rgb()
            .expect("static staging copy must finish within the existing deadline");
        assert_eq!(image.dimensions(), (32, 16));
        assert_eq!(captured_at_ms, 123);
        assert!(image.pixels().all(|pixel| pixel.0 == [0, 255, 0]));
    }
}
