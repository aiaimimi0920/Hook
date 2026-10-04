"""Protect the product check identity and all parallelized packaging gates."""
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = (ROOT / ".github/workflows/build-hook-exe.yml").read_text(encoding="utf-8")


def job(name):
    match = re.search(r"(?ms)^  " + re.escape(name) + r":\n(.*?)(?=^  [\w-]+:|\Z)", WORKFLOW)
    if not match:
        raise AssertionError(f"Missing job: {name}")
    return match[1]


class BuildGateTests(unittest.TestCase):
    def test_independent_work_has_no_serial_dependency(self):
        for name in ("frontend-serial", "build-windows-candidate", "parallel-race"):
            self.assertNotIn("needs:", job(name))
        serial = job("frontend-serial")
        for command in ("npm test", "npm run test:effective-lines",
                        "npm run typecheck", "npm run typecheck:test"):
            self.assertIn("run: " + command + "\n", serial)
        self.assertNotIn("run: npm test\n", job("build-windows-candidate"))

    def test_stable_check_fails_closed_before_promotion(self):
        aggregate = job("build-windows-exe")
        self.assertIn("needs: [frontend-serial, build-windows-candidate, parallel-race]", aggregate)
        self.assertIn("if: ${{ always() }}", aggregate)
        for variable, dependency in (("FRONTEND", "frontend-serial"),
                                     ("BUILD", "build-windows-candidate"),
                                     ("PARALLEL", "parallel-race")):
            self.assertIn(variable + ": ${{ needs." + dependency + ".result }}", aggregate)
            self.assertIn(f'test "${variable}" = success', aggregate)
        self.assertLess(aggregate.index('test "$PARALLEL"'), aggregate.index("Download same-run"))
        self.assertIn("name: hook-build-candidate", aggregate)
        self.assertIn("name: hook-portable-windows-x64", aggregate)
        self.assertEqual(aggregate.count("if:"), 1)
        self.assertIn("shell: bash", aggregate)
        for override in ("run-id:", "repository:", "github-token:"):
            self.assertNotIn(override, aggregate)
        self.assertNotIn("hook-portable-windows-x64", job("build-windows-candidate"))
        self.assertNotIn("continue-on-error", WORKFLOW)

    def test_cache_never_skips_browser_or_rust_gates(self):
        parallel = job("parallel-race")
        for command in ("npm run test:parallel", "npm run test:performance",
                        "npx playwright install --with-deps chromium",
                        "npm run test:surface-browser",
                        "node scripts/test-qr-worker-browser.mjs",
                        "cargo test --manifest-path src-tauri/Cargo.toml"):
            self.assertIn("run: " + command, parallel)
        self.assertIn("hashFiles('package-lock.json')", parallel)
        self.assertIn("${{ runner.os }}-${{ runner.arch }}", parallel)
        self.assertNotIn("cache-hit", parallel)
        candidate = job("build-windows-candidate")
        self.assertIn("run-rust-tests-ci.ps1", candidate)
        self.assertIn("assert-release-version.ps1", candidate)
        self.assertIn("build-local-hook-exe.ps1", candidate)


if __name__ == "__main__":
    unittest.main()
