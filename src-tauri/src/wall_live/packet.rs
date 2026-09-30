//! Validate the wall media envelope and PNG allocation bounds before crossing IPC.
use super::{WallMediaFormat, MAX_FRAME_BYTES};
pub(super) const HEADER_LEN: usize = 80;
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

pub(super) fn validate(
    bytes: &[u8],
    format: WallMediaFormat,
    previous: (u64, u64),
    received_at: u64,
) -> Result<(u64, u64, u64), &'static str> {
    if bytes.len() < HEADER_LEN
        || bytes.len() > MAX_FRAME_BYTES + HEADER_LEN
        || bytes[..8] != [b'N', b'L', b'W', b'M', 1, 1, 0, 80]
        || bytes[56] != 1
        || bytes[58..64].iter().any(|byte| *byte != 0)
        || u32_at(bytes, 52) as usize != bytes.len() - HEADER_LEN
    {
        return Err("wall_live_frame_invalid");
    }
    let codec = match bytes[57] {
        1 => WallMediaFormat::RawBgra,
        2 => WallMediaFormat::Png,
        _ => return Err("wall_live_frame_unsupported"),
    };
    if codec != format {
        return Err("wall_live_frame_unsupported");
    }
    let identity = (u64_at(bytes, 8), u64_at(bytes, 16));
    if identity.0 == 0 || identity.1 == 0 {
        return Err("wall_live_frame_invalid");
    }
    if identity <= previous {
        return Err("wall_live_frame_stale");
    }
    let received = u64_at(bytes, 64);
    if [24, 32, 64, 72]
        .iter()
        .any(|at| u64_at(bytes, *at) > MAX_SAFE_INTEGER)
        || received == 0
        || received < received_at
        || u64_at(bytes, 72) < received
    {
        return Err("wall_live_frame_time_invalid");
    }
    let (width, height) = (u32_at(bytes, 40), u32_at(bytes, 44));
    let payload = &bytes[HEADER_LEN..];
    if width == 0
        || height == 0
        || width > 16_384
        || height > 16_384
        || match codec {
            WallMediaFormat::RawBgra => {
                u64::from(width) * u64::from(height) * 4 != payload.len() as u64
            }
            WallMediaFormat::Png => {
                width > 1280
                    || height > 720
                    || payload.len() > 4 * 1024 * 1024
                    || !valid_png(payload, width, height)
            }
        }
    {
        return Err("wall_live_dimensions_invalid");
    }
    Ok((identity.0, identity.1, received))
}

fn u32_at(bytes: &[u8], at: usize) -> u32 {
    u32::from_be_bytes(bytes[at..at + 4].try_into().expect("checked packet"))
}
fn u64_at(bytes: &[u8], at: usize) -> u64 {
    u64::from_be_bytes(bytes[at..at + 8].try_into().expect("checked packet"))
}

fn valid_png(bytes: &[u8], width: u32, height: u32) -> bool {
    if bytes.len() < 57
        || !bytes.starts_with(b"\x89PNG\r\n\x1a\n")
        || u32_at(bytes, 8) != 13
        || &bytes[12..16] != b"IHDR"
        || u32_at(bytes, 16) != width
        || u32_at(bytes, 20) != height
        || bytes[24..29] != [8, 2, 0, 0, 0]
    {
        return false;
    }
    let mut at = 33;
    let mut data = false;
    while bytes.len().saturating_sub(at) >= 12 {
        let length = u32_at(bytes, at) as usize;
        if length > bytes.len() - at - 12 {
            return false;
        }
        match &bytes[at + 4..at + 8] {
            b"IDAT" => data = true,
            b"IEND" => return data && length == 0 && at + 12 == bytes.len(),
            _ => return false,
        }
        at += length + 12;
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn golden_packets_reject_stale_identity_wrong_codec_and_png_allocation_spoofing() {
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../../__tests__/fixtures/wall/wall-media.v1.json"
        ))
        .unwrap();
        for (name, format) in [
            ("raw_bgra", WallMediaFormat::RawBgra),
            ("png", WallMediaFormat::Png),
        ] {
            let hex = fixture[name].as_str().unwrap();
            let bytes: Vec<u8> = (0..hex.len())
                .step_by(2)
                .map(|at| u8::from_str_radix(&hex[at..at + 2], 16).unwrap())
                .collect();
            assert_eq!(
                validate(&bytes, format, (2, 6), 0).unwrap(),
                (2, 7, 1_700_000_000_020)
            );
            assert_eq!(
                validate(&bytes, format, (2, 7), 0),
                Err("wall_live_frame_stale")
            );
            assert!(validate(&bytes, format, (3, 0), 0).is_err());
            assert!(validate(&bytes, format, (0, 0), 1_700_000_000_025).is_err());
            for at in [0, 4, 5, 7, 52, 56, 57, 58, 63] {
                let mut invalid = bytes.clone();
                invalid[at] = 255;
                assert!(
                    validate(&invalid, format, (0, 0), 0).is_err(),
                    "offset {at}"
                );
            }
            if format == WallMediaFormat::Png {
                assert!(validate(&bytes, WallMediaFormat::RawBgra, (0, 0), 0).is_err());
                let mut invalid = bytes;
                invalid[96..100].copy_from_slice(&16_384u32.to_be_bytes());
                assert_eq!(
                    validate(&invalid, format, (0, 0), 0),
                    Err("wall_live_dimensions_invalid")
                );
            }
        }
    }
}
