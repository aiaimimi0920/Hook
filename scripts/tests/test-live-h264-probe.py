"""C1 独立解码验证器的预算和像素判定合同，不调用硬件或 FFmpeg。"""
import importlib.util
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location(
    "h264_verifier", Path(__file__).resolve().parents[1] / "verify-live-h264-probe.py")
VERIFIER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(VERIFIER)


class DecoderContract(unittest.TestCase):
    def test_gpu_fixture_uses_limited_range_not_cpu_nv12(self):
        self.assertEqual(VERIFIER.expected_luma(0, "synthetic_gpu_bgra_nv12"), 43)
        self.assertEqual(VERIFIER.expected_luma(23, "synthetic_gpu_bgra_nv12"), 122)
        with self.assertRaises(ValueError):
            VERIFIER.expected_luma(0, "unknown")
        with tempfile.TemporaryDirectory() as root:
            target = Path(root) / "gpu.nv12"
            pixels = 320 * 240
            target.write_bytes(bytes([43]) * pixels + bytes([128]) * (pixels // 2))
            with patch.object(VERIFIER.subprocess, "run", return_value=SimpleNamespace(returncode=0)):
                result = VERIFIER.decode(Path("ffmpeg"), Path("input"), target, 0, 1, "synthetic_gpu_bgra_nv12")
                self.assertEqual(result["maxLumaError"], 0)
                with self.assertRaises(ValueError):
                    VERIFIER.decode(Path("ffmpeg"), Path("input"), target, 0, 1)

    def test_read_budget_rejects_overflow(self):
        with tempfile.TemporaryDirectory() as root:
            file = Path(root) / "input"
            file.write_bytes(b"12345")
            self.assertEqual(VERIFIER.read_bounded(file, 5), b"12345")
            with self.assertRaises(ValueError):
                VERIFIER.read_bounded(file, 4)

    def test_pixel_sequence_and_external_decoder_limits(self):
        with tempfile.TemporaryDirectory() as root:
            target = Path(root) / "output.nv12"
            pixels = 320 * 240
            target.write_bytes(b"".join(bytes([32 + i * 4]) * pixels
                                        + bytes([128]) * (pixels // 2) for i in [12, 13]))
            with patch.object(VERIFIER.subprocess, "run", return_value=SimpleNamespace(returncode=0)) as run:
                result = VERIFIER.decode(Path("ffmpeg"), Path("input.h264"), target, 12, 2)
            self.assertEqual(result, {"frames": 2, "maxLumaError": 0, "maxChromaError": 0})
            argv = run.call_args.args[0]
            self.assertEqual(argv[argv.index("-max_pixels") + 1], "76800")
            self.assertEqual(argv[argv.index("-frames:v") + 1], "3")
            self.assertIn("-n", argv)
            self.assertIn("-nostdin", argv)
            self.assertEqual(run.call_args.kwargs["timeout"], 30)

    def test_wrong_pixel_values_or_frame_count_fail(self):
        with tempfile.TemporaryDirectory() as root:
            target = Path(root) / "output.nv12"
            with patch.object(VERIFIER.subprocess, "run", return_value=SimpleNamespace(returncode=0)):
                for raw in [b"", bytes(320 * 240 * 3 // 2), bytes(320 * 240 * 3)]:
                    target.write_bytes(raw)
                    with self.assertRaises(ValueError):
                        VERIFIER.decode(Path("ffmpeg"), Path("input.h264"), target, 0, 1)

    def test_decoder_failure_is_not_a_successful_empty_video(self):
        failure = SimpleNamespace(returncode=1, stderr=b"decoder error")
        with patch.object(VERIFIER.subprocess, "run", return_value=failure):
            with self.assertRaisesRegex(ValueError, "decoder failed"):
                VERIFIER.decode(Path("ffmpeg"), Path("input.h264"), Path("unused"), 0, 1)


if __name__ == "__main__":
    unittest.main()
