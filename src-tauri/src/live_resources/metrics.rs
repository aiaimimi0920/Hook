//! Low-frequency OS counters; no processes, counters service or polling thread is created.
use super::policy::Sample;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};
use windows::core::Interface;
use windows::Win32::Foundation::FILETIME;
use windows::Win32::Graphics::Direct3D11::ID3D11Device;
use windows::Win32::Graphics::Dxgi::{
    IDXGIAdapter3, IDXGIDevice, DXGI_MEMORY_SEGMENT_GROUP_LOCAL, DXGI_QUERY_VIDEO_MEMORY_INFO,
};
use windows::Win32::System::ProcessStatus::{GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS_EX};
use windows::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
use windows::Win32::System::Threading::{GetCurrentProcess, GetProcessTimes, GetSystemTimes};

#[derive(Default)]
struct Sampler {
    at: Option<Instant>,
    sample: Sample,
    times: Option<(u64, u64, u64)>,
    adapter: Option<IDXGIAdapter3>,
}
static SAMPLER: LazyLock<Mutex<Sampler>> = LazyLock::new(|| Mutex::new(Sampler::default()));

pub fn set_device(device: &ID3D11Device) {
    if let Ok(mut sampler) = SAMPLER.lock() {
        if sampler.adapter.is_none() {
            sampler.adapter = device
                .cast::<IDXGIDevice>()
                .ok()
                .and_then(|device| unsafe { device.GetAdapter() }.ok())
                .and_then(|adapter| adapter.cast().ok());
            if sampler.adapter.is_some() {
                sampler.at = None;
            }
        }
    }
}

fn ticks(value: FILETIME) -> u64 {
    (u64::from(value.dwHighDateTime) << 32) | u64::from(value.dwLowDateTime)
}

fn times() -> Option<(u64, u64, u64)> {
    let (mut idle, mut kernel, mut user) = (
        FILETIME::default(),
        FILETIME::default(),
        FILETIME::default(),
    );
    unsafe { GetSystemTimes(Some(&mut idle), Some(&mut kernel), Some(&mut user)) }.ok()?;
    let (mut creation, mut exit, mut process_kernel, mut process_user) = (
        FILETIME::default(),
        FILETIME::default(),
        FILETIME::default(),
        FILETIME::default(),
    );
    unsafe {
        GetProcessTimes(
            GetCurrentProcess(),
            &mut creation,
            &mut exit,
            &mut process_kernel,
            &mut process_user,
        )
    }
    .ok()?;
    Some((
        ticks(idle),
        ticks(kernel) + ticks(user),
        ticks(process_kernel) + ticks(process_user),
    ))
}

pub fn sample() -> Result<Sample, &'static str> {
    let mut sampler = SAMPLER
        .lock()
        .map_err(|_| "live_resource_telemetry_unavailable")?;
    if sampler
        .at
        .is_some_and(|at| at.elapsed() < Duration::from_secs(1))
    {
        return Ok(sampler.sample);
    }
    let mut memory = MEMORYSTATUSEX {
        dwLength: std::mem::size_of::<MEMORYSTATUSEX>() as u32,
        ..Default::default()
    };
    unsafe { GlobalMemoryStatusEx(&mut memory) }
        .map_err(|_| "live_resource_telemetry_unavailable")?;
    let mut counters = PROCESS_MEMORY_COUNTERS_EX::default();
    let private_bytes = unsafe {
        GetProcessMemoryInfo(
            GetCurrentProcess(),
            (&mut counters as *mut PROCESS_MEMORY_COUNTERS_EX).cast(),
            std::mem::size_of_val(&counters) as u32,
        )
    }
    .ok()
    .map(|_| counters.PrivateUsage as u64);
    let current = times();
    let cpu = current.zip(sampler.times).and_then(
        |((idle, total, process), (old_idle, old_total, old_process))| {
            let elapsed = total.checked_sub(old_total)?;
            if elapsed == 0 {
                return None;
            }
            Some((
                (1.0 - idle.checked_sub(old_idle)? as f64 / elapsed as f64).clamp(0.0, 1.0),
                (process.checked_sub(old_process)? as f64 / elapsed as f64).clamp(0.0, 1.0),
            ))
        },
    );
    let gpu = sampler
        .adapter
        .as_ref()
        .and_then(|adapter| {
            let mut info = DXGI_QUERY_VIDEO_MEMORY_INFO::default();
            unsafe { adapter.QueryVideoMemoryInfo(0, DXGI_MEMORY_SEGMENT_GROUP_LOCAL, &mut info) }
                .ok()?;
            Some(info)
        })
        .filter(|info| info.Budget > 0);
    sampler.sample = Sample {
        sequence: sampler.sample.sequence.saturating_add(1),
        total_memory: memory.ullTotalPhys,
        available_memory: memory.ullAvailPhys,
        private_bytes,
        system_cpu: cpu.map(|cpu| cpu.0),
        process_cpu: cpu.map(|cpu| cpu.1),
        gpu_budget: gpu.as_ref().map(|gpu| gpu.Budget),
        gpu_usage: gpu.map(|gpu| gpu.CurrentUsage),
    };
    sampler.at = Some(Instant::now());
    sampler.times = current;
    Ok(sampler.sample)
}
