// Exact NLLV binary framing and the JPEG-to-BGRA boundary used by Phase 4 transport.
const LIVE_RELAY_BINARY_HEADER_LEN: usize = 64;

#[derive(Clone, Debug, Eq, PartialEq)]
struct LiveRelayBinaryMetadata {
    epoch: u64,
    frame_id: u64,
    capture_timestamp_ms: u64,
    encode_timestamp_ms: u64,
    width: u32,
    height: u32,
    dropped_frames: u32,
    keyframe: bool,
    color_space: &'static str,
    codec: &'static str,
}

fn encode_live_relay_capture_frame(frame: &LiveCaptureFrame) -> Result<Vec<u8>, String> {
    let decoded = image::load_from_memory(&frame.bytes)
        .map_err(|error| format!("decode local live JPEG for relay: {error}"))?;
    let mut bgra = decoded.to_rgba8().into_raw();
    for pixel in bgra.chunks_exact_mut(4) {
        pixel.swap(0, 2);
    }
    let expected = usize::try_from(frame.descriptor.width)
        .ok()
        .and_then(|width| {
            usize::try_from(frame.descriptor.height)
                .ok()
                .and_then(|height| width.checked_mul(height))
        })
        .and_then(|pixels| pixels.checked_mul(4))
        .ok_or_else(|| "live relay BGRA dimensions overflow".to_owned())?;
    if bgra.len() != expected {
        return Err("decoded live relay frame dimensions do not match capture metadata".to_owned());
    }
    if bgra.is_empty() || bgra.len() > LIVE_RELAY_MAX_FRAME_BYTES {
        return Err("live relay BGRA frame exceeds the 64 MiB protocol limit".to_owned());
    }
    let dropped_frames = frame.descriptor.dropped_frames.min(u64::from(u32::MAX)) as u32;
    encode_live_relay_binary_frame(
        &LiveRelayBinaryMetadata {
            epoch: frame.descriptor.epoch,
            frame_id: frame.descriptor.frame_id,
            capture_timestamp_ms: frame.descriptor.capture_timestamp_ms,
            encode_timestamp_ms: live_capture_now_ms(),
            width: frame.descriptor.width,
            height: frame.descriptor.height,
            dropped_frames,
            keyframe: true,
            color_space: "srgb",
            codec: "raw_bgra",
        },
        &bgra,
    )
}

fn encode_live_relay_binary_frame(
    metadata: &LiveRelayBinaryMetadata,
    payload: &[u8],
) -> Result<Vec<u8>, String> {
    validate_live_relay_binary_metadata(metadata, payload.len())?;
    let payload_len = u32::try_from(payload.len())
        .map_err(|_| "live relay frame payload is too large".to_owned())?;
    let mut bytes = vec![0_u8; LIVE_RELAY_BINARY_HEADER_LEN + payload.len()];
    bytes[0..4].copy_from_slice(b"NLLV");
    bytes[4] = 1;
    bytes[5] = u8::from(metadata.keyframe);
    bytes[6..8].copy_from_slice(&(LIVE_RELAY_BINARY_HEADER_LEN as u16).to_be_bytes());
    bytes[8..16].copy_from_slice(&metadata.epoch.to_be_bytes());
    bytes[16..24].copy_from_slice(&metadata.frame_id.to_be_bytes());
    bytes[24..32].copy_from_slice(&metadata.capture_timestamp_ms.to_be_bytes());
    bytes[32..40].copy_from_slice(&metadata.encode_timestamp_ms.to_be_bytes());
    bytes[40..44].copy_from_slice(&metadata.width.to_be_bytes());
    bytes[44..48].copy_from_slice(&metadata.height.to_be_bytes());
    bytes[48..52].copy_from_slice(&metadata.dropped_frames.to_be_bytes());
    bytes[52..56].copy_from_slice(&payload_len.to_be_bytes());
    bytes[56] = match metadata.color_space {
        "srgb" => 1,
        "hdr10" => 2,
        _ => return Err("live relay frame color space is unsupported".to_owned()),
    };
    bytes[57] = match metadata.codec {
        "raw_bgra" => 1,
        "h264" => 2,
        _ => return Err("live relay frame codec is unsupported".to_owned()),
    };
    bytes[LIVE_RELAY_BINARY_HEADER_LEN..].copy_from_slice(payload);
    Ok(bytes)
}

fn decode_live_relay_binary_frame(
    relay_id: &str,
    live_session_id: &str,
    bytes: &[u8],
) -> Result<LiveRelayFrame, String> {
    if bytes.len() < LIVE_RELAY_BINARY_HEADER_LEN {
        return Err("live relay frame header is truncated".to_owned());
    }
    if &bytes[0..4] != b"NLLV" || bytes[4] != 1 {
        return Err("live relay frame magic or version is invalid".to_owned());
    }
    if bytes[5] & !1 != 0
        || u16::from_be_bytes([bytes[6], bytes[7]]) as usize != LIVE_RELAY_BINARY_HEADER_LEN
        || bytes[58..64].iter().any(|value| *value != 0)
    {
        return Err("live relay frame header fields are invalid".to_owned());
    }
    let payload_len = usize::try_from(live_relay_u32(bytes, 52))
        .map_err(|_| "live relay frame payload length is invalid".to_owned())?;
    if payload_len == 0
        || payload_len > LIVE_RELAY_MAX_FRAME_BYTES
        || bytes.len() != LIVE_RELAY_BINARY_HEADER_LEN + payload_len
    {
        return Err("live relay frame payload length does not match the header".to_owned());
    }
    let color_space = match bytes[56] {
        1 => "srgb",
        2 => "hdr10",
        _ => return Err("live relay frame color space is invalid".to_owned()),
    };
    let codec = match bytes[57] {
        1 => "raw_bgra",
        2 => "h264",
        _ => return Err("live relay frame codec is invalid".to_owned()),
    };
    let metadata = LiveRelayBinaryMetadata {
        epoch: live_relay_u64(bytes, 8),
        frame_id: live_relay_u64(bytes, 16),
        capture_timestamp_ms: live_relay_u64(bytes, 24),
        encode_timestamp_ms: live_relay_u64(bytes, 32),
        width: live_relay_u32(bytes, 40),
        height: live_relay_u32(bytes, 44),
        dropped_frames: live_relay_u32(bytes, 48),
        keyframe: bytes[5] & 1 != 0,
        color_space,
        codec,
    };
    validate_live_relay_binary_metadata(&metadata, payload_len)?;
    Ok(LiveRelayFrame {
        descriptor: LiveRelayFrameDescriptor {
            relay_id: relay_id.to_owned(),
            live_session_id: live_session_id.to_owned(),
            epoch: metadata.epoch,
            frame_id: metadata.frame_id,
            capture_timestamp_ms: metadata.capture_timestamp_ms,
            encode_timestamp_ms: metadata.encode_timestamp_ms,
            received_timestamp_ms: live_capture_now_ms(),
            width: metadata.width,
            height: metadata.height,
            codec: metadata.codec.to_owned(),
            color_space: metadata.color_space.to_owned(),
            byte_length: payload_len,
            dropped_frames: metadata.dropped_frames,
        },
        payload: bytes[LIVE_RELAY_BINARY_HEADER_LEN..].to_vec(),
    })
}

fn validate_live_relay_binary_metadata(
    metadata: &LiveRelayBinaryMetadata,
    payload_len: usize,
) -> Result<(), String> {
    if metadata.epoch == 0 || metadata.frame_id == 0 {
        return Err("live relay frame epoch and frame id must be positive".to_owned());
    }
    if metadata.width == 0
        || metadata.height == 0
        || metadata.width > 16_384
        || metadata.height > 16_384
    {
        return Err("live relay frame dimensions are invalid".to_owned());
    }
    if payload_len == 0 || payload_len > LIVE_RELAY_MAX_FRAME_BYTES {
        return Err("live relay frame payload is outside protocol bounds".to_owned());
    }
    if metadata.codec == "raw_bgra" {
        let expected = usize::try_from(metadata.width)
            .ok()
            .and_then(|width| {
                usize::try_from(metadata.height)
                    .ok()
                    .and_then(|height| width.checked_mul(height))
            })
            .and_then(|pixels| pixels.checked_mul(4));
        if expected != Some(payload_len) {
            return Err("raw BGRA live relay payload size is invalid".to_owned());
        }
    }
    Ok(())
}

fn live_relay_u64(bytes: &[u8], offset: usize) -> u64 {
    u64::from_be_bytes(
        bytes[offset..offset + 8]
            .try_into()
            .expect("fixed NLLV field"),
    )
}

fn live_relay_u32(bytes: &[u8], offset: usize) -> u32 {
    u32::from_be_bytes(
        bytes[offset..offset + 4]
            .try_into()
            .expect("fixed NLLV field"),
    )
}

#[cfg(test)]
mod live_relay_protocol_tests {
    use super::*;

    #[test]
    fn nllv_round_trip_preserves_raw_bgra_identity() {
        let metadata = LiveRelayBinaryMetadata {
            epoch: 2,
            frame_id: 9,
            capture_timestamp_ms: 100,
            encode_timestamp_ms: 110,
            width: 2,
            height: 1,
            dropped_frames: 3,
            keyframe: true,
            color_space: "srgb",
            codec: "raw_bgra",
        };
        let encoded = encode_live_relay_binary_frame(&metadata, &[1; 8]).expect("encode");
        let decoded =
            decode_live_relay_binary_frame("relay:test", "live:test", &encoded).expect("decode");
        assert_eq!(decoded.descriptor.epoch, 2);
        assert_eq!(decoded.descriptor.frame_id, 9);
        assert_eq!(decoded.descriptor.codec, "raw_bgra");
        assert_eq!(decoded.payload, vec![1; 8]);
    }

    #[test]
    fn nllv_rejects_mismatched_raw_bgra_length_and_reserved_bytes() {
        let metadata = LiveRelayBinaryMetadata {
            epoch: 1,
            frame_id: 1,
            capture_timestamp_ms: 1,
            encode_timestamp_ms: 1,
            width: 2,
            height: 1,
            dropped_frames: 0,
            keyframe: true,
            color_space: "srgb",
            codec: "raw_bgra",
        };
        assert!(encode_live_relay_binary_frame(&metadata, &[0; 4]).is_err());
        let mut encoded = encode_live_relay_binary_frame(&metadata, &[0; 8]).expect("encode");
        encoded[63] = 1;
        assert!(decode_live_relay_binary_frame("relay:test", "live:test", &encoded).is_err());
    }
}
