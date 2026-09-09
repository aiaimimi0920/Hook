import {
  LIVE_BINARY_VERSION,
  LIVE_MAX_DIMENSION,
  LIVE_MAX_FRAME_PAYLOAD,
  type LiveCodec,
  type LiveColorSpace,
} from "./liveProtocol";

export const LIVE_BINARY_HEADER_LENGTH = 64;
const MAGIC = new Uint8Array([0x4e, 0x4c, 0x4c, 0x56]);

export interface LiveBinaryFrame {
  epoch: bigint;
  frameId: bigint;
  captureTimestampMs: bigint;
  encodeTimestampMs: bigint;
  width: number;
  height: number;
  keyframe: boolean;
  droppedFrames: number;
  colorSpace: LiveColorSpace;
  codec: LiveCodec;
  payload: Uint8Array;
}

export function encodeLiveBinaryFrame(frame: LiveBinaryFrame): Uint8Array {
  validateFrame(frame);
  const output = new Uint8Array(LIVE_BINARY_HEADER_LENGTH + frame.payload.byteLength);
  output.set(MAGIC, 0);
  const view = new DataView(output.buffer);
  view.setUint8(4, LIVE_BINARY_VERSION);
  view.setUint8(5, frame.keyframe ? 1 : 0);
  view.setUint16(6, LIVE_BINARY_HEADER_LENGTH);
  view.setBigUint64(8, frame.epoch);
  view.setBigUint64(16, frame.frameId);
  view.setBigUint64(24, frame.captureTimestampMs);
  view.setBigUint64(32, frame.encodeTimestampMs);
  view.setUint32(40, frame.width);
  view.setUint32(44, frame.height);
  view.setUint32(48, frame.droppedFrames);
  view.setUint32(52, frame.payload.byteLength);
  view.setUint8(56, frame.colorSpace === "srgb" ? 1 : 2);
  view.setUint8(57, frame.codec === "raw_bgra" ? 1 : 2);
  output.set(frame.payload, LIVE_BINARY_HEADER_LENGTH);
  return output;
}

export function decodeLiveBinaryFrame(input: Uint8Array): LiveBinaryFrame {
  if (input.byteLength < LIVE_BINARY_HEADER_LENGTH) throw new Error("live frame is truncated");
  if (!MAGIC.every((value, index) => input[index] === value)) throw new Error("invalid live frame magic");
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  if (view.getUint8(4) !== LIVE_BINARY_VERSION) throw new Error("unsupported live binary version");
  if ((view.getUint8(5) & ~1) !== 0) throw new Error("invalid live frame flags");
  if (view.getUint16(6) !== LIVE_BINARY_HEADER_LENGTH) throw new Error("invalid live header length");
  if (input.subarray(58, 64).some((value) => value !== 0)) throw new Error("invalid live reserved bytes");
  const payloadLength = view.getUint32(52);
  if (payloadLength === 0 || payloadLength > LIVE_MAX_FRAME_PAYLOAD) {
    throw new Error("invalid live payload length");
  }
  if (input.byteLength !== LIVE_BINARY_HEADER_LENGTH + payloadLength) {
    throw new Error("live payload length mismatch");
  }
  const colorSpace = decodeColorSpace(view.getUint8(56));
  const codec = decodeCodec(view.getUint8(57));
  const frame: LiveBinaryFrame = {
    epoch: view.getBigUint64(8),
    frameId: view.getBigUint64(16),
    captureTimestampMs: view.getBigUint64(24),
    encodeTimestampMs: view.getBigUint64(32),
    width: view.getUint32(40),
    height: view.getUint32(44),
    keyframe: (view.getUint8(5) & 1) !== 0,
    droppedFrames: view.getUint32(48),
    colorSpace,
    codec,
    payload: input.slice(LIVE_BINARY_HEADER_LENGTH),
  };
  validateFrame(frame);
  return frame;
}

function validateFrame(frame: LiveBinaryFrame): void {
  if (frame.epoch <= 0n || frame.frameId <= 0n) throw new Error("invalid live frame identity");
  if (frame.encodeTimestampMs < frame.captureTimestampMs) throw new Error("invalid live frame timestamps");
  if (
    frame.width <= 0 ||
    frame.height <= 0 ||
    frame.width > LIVE_MAX_DIMENSION ||
    frame.height > LIVE_MAX_DIMENSION
  ) {
    throw new Error("invalid live frame dimensions");
  }
  if (frame.payload.byteLength === 0 || frame.payload.byteLength > LIVE_MAX_FRAME_PAYLOAD) {
    throw new Error("invalid live payload length");
  }
}

function decodeColorSpace(value: number): LiveColorSpace {
  if (value === 1) return "srgb";
  if (value === 2) return "hdr10";
  throw new Error("invalid live color space");
}

function decodeCodec(value: number): LiveCodec {
  if (value === 1) return "raw_bgra";
  if (value === 2) return "h264";
  throw new Error("invalid live codec");
}
