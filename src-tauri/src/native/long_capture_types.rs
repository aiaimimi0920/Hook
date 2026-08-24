// Defines long-capture session state, work items, responses, and frame fingerprints.

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LongCaptureWheelEvent {
    delta_x: i64,
    delta_y: i64,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct LongCaptureSessionRect {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

#[derive(Clone, Debug)]
struct LongCaptureSessionState {
    rect: LongCaptureSessionRect,
    axis: Option<long_capture::LongCaptureAxis>,
    direction: Option<long_capture::LongCaptureDirection>,
    frames: Vec<image::RgbImage>,
    last_frame_fingerprint: Option<Arc<LongCaptureFrameFingerprint>>,
    pair_analyses: Vec<long_capture::LongCaptureOverlapAnalysis>,
    incremental_stitcher: Option<long_capture::LongCaptureIncrementalStitcher>,
    stitch_worker_active: bool,
    stitch_error: Option<String>,
    duplicate_count: usize,
    max_scan: u32,
    min_overlap_px: u32,
    created_at: Instant,
}

#[derive(Clone)]
struct SharedLongCaptureSessions {
    sessions: Arc<std::sync::Mutex<HashMap<String, LongCaptureSessionState>>>,
}

impl SharedLongCaptureSessions {
    fn new() -> Self {
        Self {
            sessions: Arc::new(std::sync::Mutex::new(HashMap::new())),
        }
    }
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "snake_case")]
enum LongCaptureSessionSampleStatus {
    Recorded,
    Duplicate,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LongCaptureSessionSampleResponse {
    status: LongCaptureSessionSampleStatus,
    frame_count: usize,
    duplicate_count: usize,
    recorded: bool,
    axis: Option<long_capture::LongCaptureAxis>,
    direction: Option<long_capture::LongCaptureDirection>,
}

#[derive(Clone)]
struct LongCaptureSessionSampleWork {
    rect: LongCaptureSessionRect,
    previous_fingerprint: Option<Arc<LongCaptureFrameFingerprint>>,
    expected_frame_count: usize,
    axis: Option<long_capture::LongCaptureAxis>,
    max_scan: u32,
    min_overlap_px: u32,
}

struct LongCaptureSessionSampleResult {
    frame: image::RgbImage,
    fingerprint: LongCaptureFrameFingerprint,
    status: LongCaptureSessionSampleStatus,
    analysis: Option<long_capture::LongCaptureOverlapAnalysis>,
    expected_frame_count: usize,
}

struct LongCaptureRecordingClassification {
    status: LongCaptureSessionSampleStatus,
    analysis: Option<long_capture::LongCaptureOverlapAnalysis>,
}

#[derive(Clone, Debug)]
struct LongCaptureFrameFingerprint {
    width: u32,
    height: u32,
    byte_len: usize,
    hash: u64,
    sampled_pixels: Vec<[u8; 3]>,
    motion: long_capture::LongCaptureMotionFingerprint,
}

impl PartialEq for LongCaptureFrameFingerprint {
    fn eq(&self, other: &Self) -> bool {
        self.width == other.width
            && self.height == other.height
            && self.byte_len == other.byte_len
            && self.hash == other.hash
            && self.sampled_pixels == other.sampled_pixels
    }
}
