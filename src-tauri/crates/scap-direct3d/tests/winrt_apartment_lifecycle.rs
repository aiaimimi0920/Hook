#![cfg(windows)]

use windows::Win32::System::WinRT::{RO_INIT_MULTITHREADED, RoInitialize, RoUninitialize};

#[test]
fn capture_support_after_apartment_restart() {
    for iteration in 0..8 {
        std::thread::spawn(move || {
            unsafe { RoInitialize(RO_INIT_MULTITHREADED) }.unwrap();
            let supported = scap_direct3d::is_supported().map_err(|error| error.code());
            eprintln!("support iteration={iteration} result={supported:?}");
            unsafe { RoUninitialize() };
            assert!(supported.is_ok(), "support query failed: {supported:?}");
        })
        .join()
        .unwrap();
    }
}
