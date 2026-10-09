// Only an explicitly negotiated media connection may carry JPEG; control/discovery stays v1.
const LIVE_RELAY_JPEG_PROTOCOL: &str = "loom.live.jpeg.v1";
const LIVE_RELAY_H264_PROTOCOL: &str = "loom.live.h264.v1";
const LIVE_RELAY_VIDEO_OFFER: &str = "loom.live.h264.v1,loom.live.jpeg.v1,loom.live.v1";
// tungstenite 0.24 splits without trimming; whitespace would break legacy selection.
const LIVE_RELAY_MEDIA_OFFER: &str = "loom.live.jpeg.v1,loom.live.v1";
const LIVE_RELAY_MAX_JPEG_BYTES: usize = 16 * 1024 * 1024;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum LiveRelayMediaProfile {
    Legacy,
    Jpeg,
    H264,
}

impl LiveRelayMediaProfile {
    fn negotiated(protocol: Option<&str>) -> Result<Self, String> {
        match protocol {
            Some(LIVE_RELAY_PROTOCOL_VERSION) => Ok(Self::Legacy),
            Some(LIVE_RELAY_JPEG_PROTOCOL) => Ok(Self::Jpeg),
            Some(LIVE_RELAY_H264_PROTOCOL) => Ok(Self::H264),
            _ => Err("Loom live WebSocket selected an unsupported media profile".to_owned()),
        }
    }

    fn validate_wire(self, bytes: &[u8]) -> Result<(), String> {
        if self != Self::H264 && bytes.get(57) == Some(&2) {
            Err("Loom sent H264 without media profile negotiation".to_owned())
        } else if self == Self::Legacy && bytes.get(57) == Some(&3) {
            Err("Loom sent JPEG without media profile negotiation".to_owned())
        } else {
            Ok(())
        }
    }
}

struct LiveRelayMediaConnection {
    socket: tungstenite::WebSocket<tungstenite::stream::MaybeTlsStream<std::net::TcpStream>>,
    profile: LiveRelayMediaProfile,
}

fn live_relay_jpeg_decoder(
    bytes: &[u8],
    width: u32,
    height: u32,
) -> Result<image::codecs::jpeg::JpegDecoder<std::io::Cursor<&[u8]>>, String> {
    use image::ImageDecoder;
    if bytes.len() > LIVE_RELAY_MAX_FRAME_BYTES
        || !bytes.starts_with(&[0xff, 0xd8])
        || !bytes.ends_with(&[0xff, 0xd9])
        || width == 0
        || height == 0
        || width > 16_384
        || height > 16_384
        || u64::from(width) * u64::from(height) * 4 > LIVE_RELAY_MAX_FRAME_BYTES as u64
    {
        return Err("live relay JPEG bounds are invalid".to_owned());
    }
    let mut decoder = image::codecs::jpeg::JpegDecoder::new(std::io::Cursor::new(bytes))
        .map_err(|_| "live relay JPEG header is invalid".to_owned())?;
    if decoder.dimensions() != (width, height) {
        return Err("live relay JPEG dimensions do not match metadata".to_owned());
    }
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(16_384);
    limits.max_image_height = Some(16_384);
    limits.max_alloc = Some(128 * 1024 * 1024);
    decoder
        .set_limits(limits)
        .map_err(|_| "live relay JPEG limits are invalid".to_owned())?;
    Ok(decoder)
}

#[cfg(test)]
include!("tests/live_relay_jpeg_tests.rs");
