"""Protect the product check identity and all parallelized packaging gates."""
from pathlib import Path
import re
import os
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = (ROOT / ".github/workflows/build-otter-exe.yml").read_text(encoding="utf-8")


def job(name):
    match = re.search(r"(?ms)^  " + re.escape(name) + r":\n(.*?)(?=^  [\w-]+:|\Z)", WORKFLOW)
    if not match:
        raise AssertionError(f"Missing job: {name}")
    return match[1]


class BuildGateTests(unittest.TestCase):
    def test_independent_work_has_no_serial_dependency(self):
        for name in ("frontend-serial", "build-windows-candidate", "parallel-race"):
            self.assertIn("needs: change-scope", job(name))
            self.assertIn("if: needs.change-scope.outputs.full == 'true'", job(name))
        serial = job("frontend-serial")
        for command in ("npm test", "npm run test:effective-lines",
                        "npm run typecheck", "npm run typecheck:test"):
            self.assertIn("run: " + command + "\n", serial)
        self.assertNotIn("run: npm test\n", job("build-windows-candidate"))

    def test_stable_check_fails_closed_before_promotion(self):
        aggregate = job("build-windows-exe")
        self.assertIn("needs: [change-scope, frontend-serial, build-windows-candidate, parallel-race]", aggregate)
        self.assertIn("if: ${{ always() }}", aggregate)
        for variable, dependency in (("FRONTEND", "frontend-serial"),
                                     ("BUILD", "build-windows-candidate"),
                                     ("PARALLEL", "parallel-race")):
            self.assertIn(variable + ": ${{ needs." + dependency + ".result }}", aggregate)
            self.assertIn(f'test "${variable}" = success', aggregate)
        self.assertLess(aggregate.index('test "$PARALLEL"'), aggregate.index("Download same-run"))
        self.assertIn("name: otter-build-candidate", aggregate)
        self.assertIn("name: otter-portable-windows-x64", aggregate)
        self.assertEqual(aggregate.count("if:"), 3)
        self.assertEqual(aggregate.count("if: needs.change-scope.outputs.full == 'true'"), 2)
        self.assertIn('test "$SCOPE" = success', aggregate)
        self.assertIn('test "$FULL" = true', aggregate)
        self.assertIn("shell: bash", aggregate)
        for override in ("run-id:", "repository:", "github-token:"):
            self.assertNotIn(override, aggregate)
        self.assertNotIn("otter-portable-windows-x64", job("build-windows-candidate"))
        self.assertNotIn("continue-on-error", WORKFLOW)

    def test_docs_lane_keeps_existing_contracts_without_product_commands(self):
        docs = job("change-scope")
        for contract in ("ReadmeLocalization", "SigningDocs", "DualDistribution",
                         "PublicIdentity", "DeveloperEntrypoints", "TestEntrypoint",
                         "ArchivedDocsSanitization"):
            self.assertIn("Otter" + contract + "Contract.test.ts", docs)
        self.assertIn("npm ci --no-audit --no-fund", docs)
        self.assertIn("npx vitest run", docs)
        self.assertEqual(docs.count("if: steps.scope.outputs.full == 'false'"), 5)
        case = "documents the current public bundle identity without obsolete app-data paths"
        self.assertIn("--testNamePattern '" + case + "'", docs)
        self.assertIn("assert 'it(\"" + case + "\",' in source", docs)
        for command in ("npm test", "cargo test", "npm run build", "build-local-otter-exe"):
            self.assertNotIn(command, docs)
        self.assertNotIn("paths-ignore:", WORKFLOW)

    def test_aggregate_truth_table(self):
        # Execute the actual workflow shell, including fail-fast Actions behavior.
        aggregate = job("build-windows-exe")
        script = aggregate.split("        run: |\n", 1)[1].split("      - name:", 1)[0]
        script = "\n".join(line[10:] for line in script.splitlines())
        cases = [
            ("success", "false", "skipped", "skipped", "skipped", True),
            ("success", "true", "success", "success", "success", True),
            ("failure", "false", "skipped", "skipped", "skipped", False),
            ("cancelled", "false", "skipped", "skipped", "skipped", False),
            ("success", "", "skipped", "skipped", "skipped", False),
            ("success", "false", "success", "skipped", "skipped", False),
        ]
        for index in range(3):
            for outcome in ("failure", "cancelled", "skipped", ""):
                results = ["success"] * 3
                results[index] = outcome
                cases.append(("success", "true", *results, False))
        with tempfile.TemporaryDirectory() as directory:
            for scope, full, frontend, build, parallel, success in cases:
                env = dict(os.environ, SCOPE=scope, FULL=full, FRONTEND=frontend,
                           BUILD=build, PARALLEL=parallel,
                           GITHUB_STEP_SUMMARY=str(Path(directory) / "summary"))
                result = subprocess.run(["bash", "-e", "-c", script], env=env)
                self.assertEqual(result.returncode == 0, success,
                                 (scope, full, frontend, build, parallel))

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
        self.assertIn("build-local-otter-exe.ps1", candidate)


if __name__ == "__main__":
    unittest.main()
