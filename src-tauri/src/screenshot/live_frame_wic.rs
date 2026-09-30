// Built-in Windows codec, scoped to one call so COM handles never cross capture threads.
use windows::core::{w, Error, Result, PWSTR};
use windows::Win32::Foundation::{E_FAIL, HGLOBAL, RPC_E_CHANGED_MODE};
use windows::Win32::Graphics::Imaging::*;
use windows::Win32::System::Com::StructuredStorage::{CreateStreamOnHGlobal, PROPBAG2};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED,
    STATFLAG_NONAME, STATSTG, STREAM_SEEK_SET,
};
use windows::Win32::System::Variant::VARIANT;

struct Apartment(bool);
impl Drop for Apartment {
    fn drop(&mut self) {
        if self.0 {
            unsafe { CoUninitialize() };
        }
    }
}

pub(super) fn encode(image: &image::RgbImage, max_bytes: usize) -> Result<Vec<u8>> {
    // An already-initialized STA can use WIC too, but must not be uninitialized by us.
    let initialized = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
    if initialized.is_err() && initialized != RPC_E_CHANGED_MODE {
        initialized.ok()?;
    }
    let _apartment = Apartment(initialized.is_ok());
    unsafe {
        let factory: IWICImagingFactory =
            CoCreateInstance(&CLSID_WICImagingFactory, None, CLSCTX_INPROC_SERVER)?;
        let bitmap = factory.CreateBitmapFromMemory(
            image.width(),
            image.height(),
            &GUID_WICPixelFormat24bppRGB,
            image.width() * 3,
            image.as_raw(),
        )?;
        let converted = factory.CreateFormatConverter()?;
        converted.Initialize(
            &bitmap,
            &GUID_WICPixelFormat24bppBGR,
            WICBitmapDitherTypeNone,
            None,
            0.0,
            WICBitmapPaletteTypeCustom,
        )?;
        let stream = CreateStreamOnHGlobal(HGLOBAL::default(), true)?;
        let encoder = factory.CreateEncoder(&GUID_ContainerFormatJpeg, &GUID_VendorMicrosoft)?;
        encoder.Initialize(&stream, WICBitmapEncoderNoCache)?;
        let mut frame = None;
        let mut options = None;
        encoder.CreateNewFrame(&mut frame, &mut options)?;
        let frame = frame.ok_or_else(|| Error::from_hresult(E_FAIL))?;
        let options = options.ok_or_else(|| Error::from_hresult(E_FAIL))?;
        let quality = PROPBAG2 {
            pstrName: PWSTR(w!("ImageQuality").as_ptr().cast_mut()),
            ..Default::default()
        };
        options.Write(1, &quality, &VARIANT::from(0.82f32))?;
        // Avoid the JPEG codec's default 4:2:0 softening of colored UI/text edges.
        let sampling = PROPBAG2 {
            pstrName: PWSTR(w!("JpegYCrCbSubsampling").as_ptr().cast_mut()),
            ..Default::default()
        };
        options.Write(
            1,
            &sampling,
            &VARIANT::from(WICJpegYCrCbSubsampling444.0 as u8),
        )?;
        frame.Initialize(&options)?;
        frame.SetSize(image.width(), image.height())?;
        let mut format = GUID_WICPixelFormat24bppBGR;
        frame.SetPixelFormat(&mut format)?;
        if format != GUID_WICPixelFormat24bppBGR {
            return Err(Error::from_hresult(E_FAIL));
        }
        frame.WriteSource(&converted, std::ptr::null())?;
        frame.Commit()?;
        encoder.Commit()?;
        let mut stat = STATSTG::default();
        stream.Stat(&mut stat, STATFLAG_NONAME)?;
        let length = usize::try_from(stat.cbSize).map_err(|_| Error::from_hresult(E_FAIL))?;
        if length == 0 || length > max_bytes {
            return Err(Error::from_hresult(E_FAIL));
        }
        stream.Seek(0, STREAM_SEEK_SET, None)?;
        let mut bytes = vec![0u8; length];
        let mut read = 0;
        stream
            .Read(bytes.as_mut_ptr().cast(), length as u32, Some(&mut read))
            .ok()?;
        if read as usize != length {
            return Err(Error::from_hresult(E_FAIL));
        }
        Ok(bytes)
    }
}
