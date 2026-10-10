"""独立解码 C1 合成视频，不连接产品。FFmpeg 仅是显式提供的本地验证工具。"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys


def read_bounded(path, maximum):
    with path.open("rb") as stream:
        value = stream.read(maximum + 1)
    if len(value) > maximum:
        raise ValueError(f"input exceeds byte budget: {path.name}")
    return value


def expected_luma(index, input_kind):
    level = 32 + index * 4
    if input_kind == "synthetic_cpu_nv12":
        return level
    if input_kind in {"synthetic_gpu_bgra_nv12", "wgc_owned_window_bgra_nv12"}:
        # GPU 输入为 full-range 灰度 RGB；BT.709 limited-range Y = 16 + 219*RGB/255。
        return (16 * 255 + 219 * level + 127) // 255
    raise ValueError("unsupported synthetic input contract")


def decode(ffmpeg, source, target, first_frame, count, input_kind="synthetic_cpu_nv12"):
    expected_luma(first_frame, input_kind)
    command = [str(ffmpeg), "-hide_banner", "-loglevel", "error", "-nostdin", "-n",
               "-f", "h264", "-max_pixels", "76800", "-i", str(source),
               "-fps_mode", "passthrough", "-frames:v", str(count + 1),
               "-vf", "crop=320:240:0:0", "-pix_fmt", "nv12", "-f", "rawvideo", str(target)]
    completed = subprocess.run(command, capture_output=True, timeout=30,
                               creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    if completed.returncode:
        raise ValueError("independent decoder failed: " + completed.stderr.decode("utf-8", errors="replace")[:2000])
    pixels = 320 * 240
    stride = pixels * 3 // 2
    raw = read_bounded(target, 24 * stride)
    if len(raw) != count * stride:
        raise ValueError("decoded frame count or dimensions mismatch")
    worst_luma = worst_chroma = 0
    for index in range(count):
        frame = memoryview(raw)[index * stride:(index + 1) * stride]
        expected = expected_luma(first_frame + index, input_kind)
        worst_luma = max(worst_luma, max(abs(value - expected) for value in frame[:pixels]))
        worst_chroma = max(worst_chroma, max(abs(value - 128) for value in frame[pixels:]))
    if worst_luma > 4 or worst_chroma > 4:
        raise ValueError(f"decoded pixels differ: luma={worst_luma}, chroma={worst_chroma}")
    return {"frames": count, "maxLumaError": worst_luma, "maxChromaError": worst_chroma}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--probe-dir", required=True, type=Path)
    parser.add_argument("--ffmpeg", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    args = parser.parse_args()
    probe = args.probe_dir.resolve(strict=True)
    ffmpeg = args.ffmpeg.resolve(strict=True)
    output = args.output_dir.absolute()
    # 只创建全新证据目录，FFmpeg 同时使用 -n；不覆盖或清理历史证据。
    output.mkdir()
    report = {"status": "failed", "scope": "synthetic-hardware-encode-independent-decode"}
    try:
        summary_bytes = read_bounded(probe / "summary.json", 64 * 1024)
        summary = json.loads(summary_bytes)
        if (summary.get("status") != "hardware_encode_passed"
                or summary.get("hardwareOnly") is not True
                or (summary.get("width"), summary.get("height"), summary.get("fps")) != (320, 240, 30)
                or summary.get("forcedKeyframeInput") != 12):
            raise ValueError("probe metadata does not match the fixed synthetic contract")
        frames = summary["frames"]
        input_kind = summary.get("input")
        expected_luma(0, input_kind)
        if input_kind != "synthetic_cpu_nv12" and summary.get("gpuTextureInput") is not True:
            raise ValueError("GPU fixture lacks texture-input evidence")
        if len(frames) != 24:
            raise ValueError("expected 24 encoded frames")
        stream = read_bounded(probe / "synthetic.h264", 4 * 1024 * 1024)
        offset = 0
        for index, frame in enumerate(frames):
            size = frame["length"]
            if (type(size) is not int or not 0 < size <= 1024 * 1024
                    or frame["offset"] != offset or frame["timestamp100ns"] != index * 333333):
                raise ValueError("invalid frame boundary or ordering")
            offset += size
        if offset != len(stream) or summary["bytes"] != len(stream):
            raise ValueError("stream length does not match packet boundaries")
        version = subprocess.run([str(ffmpeg), "-version"], capture_output=True, timeout=5,
                                 check=True, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        report["decoder"] = version.stdout.decode("utf-8", errors="replace").splitlines()[0]
        report["encoder"] = summary["encoder"]
        report["input"] = input_kind
        report["streamSha256"] = hashlib.sha256(stream).hexdigest()
        report["summarySha256"] = hashlib.sha256(summary_bytes).hexdigest()
        # 用读取并校验后的快照，避免解码时源文件变化导致回执绑定错误。
        full = output / "full.h264"
        full.write_bytes(stream)
        report["fullSequence"] = decode(ffmpeg, full, output / "full.nv12", 0, 24, input_kind)
        suffix = output / "late-join.h264"
        suffix.write_bytes(stream[frames[12]["offset"]:])
        report["forcedIdrLateJoin"] = decode(ffmpeg, suffix, output / "late-join.nv12", 12, 12, input_kind)
        report["status"] = "passed"
    except Exception as error:
        report["error"] = str(error)
        raise
    finally:
        with (output / "verification.json").open("x", encoding="utf-8", newline="\n") as file:
            json.dump(report, file, ensure_ascii=False, indent=2)
            file.write("\n")
        print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
