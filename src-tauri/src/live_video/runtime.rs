//! COM/MF 仅在编码 owner 线程初始化和释放，类型不可跨线程移动。
use std::{marker::PhantomData, rc::Rc};
use windows::Win32::{Media::MediaFoundation::*, System::Com::*};

pub(super) struct Runtime(PhantomData<Rc<()>>);
impl Runtime {
    pub fn start() -> anyhow::Result<Self> {
        unsafe {
            CoInitializeEx(None, COINIT_MULTITHREADED).ok()?;
            if let Err(error) = MFStartup(MF_VERSION, MFSTARTUP_FULL) {
                CoUninitialize();
                return Err(error.into());
            }
        }
        Ok(Self(PhantomData))
    }
}
impl Drop for Runtime {
    fn drop(&mut self) {
        unsafe {
            let _ = MFShutdown();
            CoUninitialize();
        }
    }
}

#[derive(Default)]
pub(super) struct Activations {
    pub ptr: *mut Option<IMFActivate>,
    pub count: u32,
}
impl Drop for Activations {
    fn drop(&mut self) {
        if !self.ptr.is_null() {
            unsafe {
                for slot in std::slice::from_raw_parts_mut(self.ptr, self.count as usize) {
                    drop(slot.take());
                }
                CoTaskMemFree(Some(self.ptr.cast()));
            }
        }
    }
}

pub(super) struct Transform {
    pub activation: IMFActivate,
    pub transform: IMFTransform,
}
impl Drop for Transform {
    fn drop(&mut self) {
        unsafe {
            let _ = self.transform.ProcessMessage(MFT_MESSAGE_COMMAND_FLUSH, 0);
            let _ = self
                .transform
                .ProcessMessage(MFT_MESSAGE_NOTIFY_END_STREAMING, 0);
            let _ = self.activation.ShutdownObject();
        }
    }
}
