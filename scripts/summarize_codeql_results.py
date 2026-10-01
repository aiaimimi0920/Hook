"""Produce a bounded, source-text-free inventory of CodeQL SARIF results.

Counts describe results in the supplied files, not GitHub's deduplicated open
alerts. Messages, snippets, fingerprints, flows, URLs and invocation data are
never included in output. Invalid inputs fail without counts. Scanner execution
errors retain validated findings, but mark analysis incomplete and exit nonzero.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import stat
from collections import Counter
from decimal import Decimal
from pathlib import Path
from urllib.parse import unquote

MAX_FILES = 50
MAX_FILE_BYTES = 20 * 1024 * 1024
MAX_TOTAL_BYTES = 100 * 1024 * 1024
MAX_RUNS = 100
MAX_INPUT_RESULTS = 100_000
MAX_RULES = 2_000
MAX_OUTPUT_RESULTS = 5_000
MAX_DIRECTORY_ENTRIES = 10_000
MAX_COMPONENTS = 101
MAX_DIAGNOSTICS = 100_000
RULE_ID = re.compile(
    r"(?:py|js|java|go|cpp|cs|rb|swift|rust|actions|ql)/[a-z0-9-]+(?:/[a-z0-9-]+)*"
)
LEVELS = {"none", "note", "warning", "error"}


class SummaryError(ValueError):
    """A constant, safe error code; never include any untrusted input."""


class SafeArgumentParser(argparse.ArgumentParser):
    def error(self, message: str) -> None:
        print(json.dumps({"error": "invalid_arguments"}))
        raise SystemExit(2)


def _require(condition: bool, code: str = "invalid_sarif") -> None:
    if not condition:
        raise SummaryError(code)


def _integer(value: object, minimum: int, maximum: int) -> bool:
    return type(value) is int and minimum <= value <= maximum


def _rule_id(value: object) -> str:
    _require(
        isinstance(value, str)
        and len(value) <= 160
        and RULE_ID.fullmatch(value) is not None
    )
    return value


def _severity(value: object) -> str | None:
    if value is None:
        return None
    _require(type(value) in {str, int, float})
    text = str(value)
    _require(
        len(text) <= 8
        and re.fullmatch(r"(?:10(?:\.0+)?|[0-9](?:\.[0-9]{1,3})?)", text) is not None
    )
    return format(Decimal(text).normalize(), "f")


def _relative_path(value: object) -> str:
    _require(isinstance(value, str) and 0 < len(value) <= 2_048, "invalid_location")
    try:
        path = unquote(value, errors="strict")
    except UnicodeError:
        raise SummaryError("invalid_location") from None
    _require(not any(character in path for character in "\\:?#%"), "invalid_location")
    _require(
        not any(ord(character) < 32 or ord(character) == 127 for character in path),
        "invalid_location",
    )
    _require(
        all(part not in {"", ".", ".."} for part in path.split("/")), "invalid_location"
    )
    return path


def _location(result: dict, run: dict) -> tuple[str, int]:
    locations = result.get("locations")
    _require(isinstance(locations, list) and bool(locations), "missing_location")
    _require(isinstance(locations[0], dict), "invalid_location")
    physical = locations[0].get("physicalLocation")
    _require(isinstance(physical, dict), "invalid_location")
    artifact = physical.get("artifactLocation")
    _require(isinstance(artifact, dict), "invalid_location")
    if "uri" not in artifact:
        artifacts = run.get("artifacts", [])
        index = artifact.get("index")
        _require(
            isinstance(artifacts, list) and _integer(index, 0, len(artifacts) - 1),
            "invalid_location",
        )
        _require(isinstance(artifacts[index], dict), "invalid_location")
        artifact = artifacts[index].get("location")
        _require(isinstance(artifact, dict), "invalid_location")
    _require(artifact.get("uriBaseId") in {None, "%SRCROOT%"}, "invalid_location")
    path = _relative_path(artifact.get("uri"))
    region = physical.get("region")
    _require(isinstance(region, dict), "invalid_location")
    line = region.get("startLine")
    _require(_integer(line, 1, 10_000_000), "invalid_location")
    return path, line


def _run_rules(run: dict) -> list[tuple[dict, dict[str, dict]]]:
    _require(isinstance(run.get("tool"), dict))
    driver = run["tool"].get("driver")
    _require(isinstance(driver, dict))
    extensions = run["tool"].get("extensions", [])
    _require(
        isinstance(extensions, list) and len(extensions) < MAX_COMPONENTS,
        "invalid_rules",
    )
    components, count = [], 0
    for component in [driver, *extensions]:
        _require(isinstance(component, dict), "invalid_rules")
        rules = component.get("rules", [])
        _require(isinstance(rules, list), "invalid_rules")
        count += len(rules)
        _require(count <= MAX_RULES, "invalid_rules")
        indexed = {}
        for rule in rules:
            _require(isinstance(rule, dict), "invalid_rules")
            identifier = _rule_id(rule.get("id"))
            _require(identifier not in indexed, "invalid_rules")
            indexed[identifier] = rule
        components.append((component, indexed))
    return components


def _guid(value: object) -> str:
    _require(
        isinstance(value, str)
        and re.fullmatch(r"[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}", value)
        is not None,
        "invalid_rules",
    )
    return value.lower()


def _component_rules(reference: dict, components: list) -> dict[str, dict]:
    # SARIF 2.1.0 sections 3.52.7 and 3.54.2: index addresses extensions;
    # absent index/GUID means driver. Names verify identity, never select it.
    selected = 0
    if "index" in reference:
        _require(_integer(reference["index"], 0, len(components) - 2), "invalid_rules")
        selected = reference["index"] + 1
    if "guid" in reference:
        guid = _guid(reference["guid"])
        matches = [
            index
            for index, (component, _) in enumerate(components)
            if isinstance(component.get("guid"), str)
            and component["guid"].lower() == guid
        ]
        _require(len(matches) == 1, "invalid_rules")
        _require("index" not in reference or selected == matches[0], "invalid_rules")
        selected = matches[0]
    component, rules = components[selected]
    if "name" in reference:
        name = reference["name"]
        _require(
            isinstance(name, str)
            and 0 < len(name) <= 256
            and name == component.get("name"),
            "invalid_rules",
        )
    return rules


def _result_rule(result: dict, components: list) -> tuple[str, dict]:
    reference = result.get("rule", {})
    _require(isinstance(reference, dict), "invalid_rules")
    component = reference.get("toolComponent", {})
    _require(isinstance(component, dict), "invalid_rules")
    rules = _component_rules(component, components)
    for outer, inner in (("ruleId", "id"), ("ruleIndex", "index")):
        if outer in result and inner in reference:
            _require(
                type(result[outer]) is type(reference[inner])
                and result[outer] == reference[inner],
                "invalid_rules",
            )
    identifier = reference.get("id", result.get("ruleId"))
    rule = {}
    if "index" in reference or "ruleIndex" in result:
        index = reference.get("index", result.get("ruleIndex"))
        _require(_integer(index, 0, len(rules) - 1), "invalid_rules")
        rule = list(rules.values())[index]
    if "guid" in reference:
        guid = _guid(reference["guid"])
        matches = [
            entry
            for entry in rules.values()
            if isinstance(entry.get("guid"), str) and entry["guid"].lower() == guid
        ]
        _require(
            len(matches) == 1 and (not rule or rule is matches[0]), "invalid_rules"
        )
        rule = matches[0]
    if not rule:
        identifier = _rule_id(identifier)
        rule = rules.get(identifier, {})
    if rule:
        identifier = rule["id"] if identifier is None else _rule_id(identifier)
        _require(
            identifier == rule["id"] or identifier.rsplit("/", 1)[0] == rule["id"],
            "invalid_rules",
        )
    return identifier, rule


def _check_execution(run: dict) -> Counter:
    invocations = run.get("invocations", [])
    _require(isinstance(invocations, list) and len(invocations) <= MAX_DIAGNOSTICS)
    counts = Counter(
        invocation_count=len(invocations),
        failed_invocation_count=0,
        notification_count=0,
        error_count=0,
        warning_count=0,
        note_count=0,
        none_count=0,
    )
    for invocation in invocations:
        _require(isinstance(invocation, dict))
        success = invocation.get("executionSuccessful")
        _require(type(success) is bool, "invalid_execution_status")
        counts["failed_invocation_count"] += not success
        for key in ("toolExecutionNotifications", "toolConfigurationNotifications"):
            notifications = invocation.get(key, [])
            _require(isinstance(notifications, list))
            counts["notification_count"] += len(notifications)
            _require(
                counts["notification_count"] <= MAX_DIAGNOSTICS, "input_limit_exceeded"
            )
            for notification in notifications:
                _require(isinstance(notification, dict))
                level = notification.get("level", "warning")
                _require(
                    isinstance(level, str) and level in LEVELS, "invalid_diagnostic"
                )
                counts[f"{level}_count"] += 1
    return counts


def _row(result: dict, run: dict, rules: list) -> dict:
    _require(isinstance(result, dict))
    identifier, rule = _result_rule(result, rules)
    configuration = rule.get("defaultConfiguration", {})
    properties = rule.get("properties", {})
    _require(
        isinstance(configuration, dict) and isinstance(properties, dict),
        "invalid_rules",
    )
    level = result.get("level", configuration.get("level", "warning"))
    _require(isinstance(level, str) and level in LEVELS)
    path, line = _location(result, run)
    return {
        "rule_id": identifier,
        "path": path,
        "line": line,
        "level": level,
        "security_severity": _severity(properties.get("security-severity")),
    }


def _read_sarif(path: Path) -> tuple[dict, int]:
    _require(not path.is_symlink(), "unsafe_input")
    descriptor = os.open(
        path,
        os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0),
    )
    with os.fdopen(descriptor, "rb") as stream:
        details = os.fstat(stream.fileno())
        _require(stat.S_ISREG(details.st_mode), "unsafe_input")
        _require(details.st_size <= MAX_FILE_BYTES, "input_limit_exceeded")
        raw = stream.read(MAX_FILE_BYTES + 1)
    _require(len(raw) <= MAX_FILE_BYTES, "input_limit_exceeded")
    try:
        payload = json.loads(raw)
    except (ValueError, UnicodeError, RecursionError):
        raise SummaryError("invalid_sarif") from None
    _require(isinstance(payload, dict) and payload.get("version") == "2.1.0")
    return payload, len(raw)


def _walk_error(error: OSError) -> None:
    raise SummaryError("unreadable_input") from None


def summarize(directory: Path, max_results: int = 500) -> dict:
    _require(_integer(max_results, 1, MAX_OUTPUT_RESULTS), "invalid_output_limit")
    _require(
        directory.is_dir() and not directory.is_symlink(), "missing_input_directory"
    )
    files, entries = [], 0
    for root, directories, names in os.walk(
        directory, followlinks=False, onerror=_walk_error
    ):
        entries += len(directories) + len(names)
        _require(entries <= MAX_DIRECTORY_ENTRIES, "input_limit_exceeded")
        _require(
            not any((Path(root) / name).is_symlink() for name in directories),
            "unsafe_input",
        )
        files.extend(Path(root) / name for name in names if name.endswith(".sarif"))
        _require(len(files) <= MAX_FILES, "input_limit_exceeded")
    _require(bool(files), "missing_sarif")
    rows, by_rule, by_severity, diagnostics = [], Counter(), Counter(), Counter()
    total = runs_count = total_bytes = 0
    for path in sorted(files):
        payload, size = _read_sarif(path)
        total_bytes += size
        _require(total_bytes <= MAX_TOTAL_BYTES, "input_limit_exceeded")
        runs = payload.get("runs")
        _require(isinstance(runs, list) and bool(runs), "missing_runs")
        runs_count += len(runs)
        _require(runs_count <= MAX_RUNS, "input_limit_exceeded")
        for run in runs:
            _require(isinstance(run, dict))
            diagnostics.update(_check_execution(run))
            _require(
                diagnostics["notification_count"] <= MAX_DIAGNOSTICS
                and diagnostics["invocation_count"] <= MAX_DIAGNOSTICS,
                "input_limit_exceeded",
            )
            rules = _run_rules(run)
            results = run.get("results")
            _require(isinstance(results, list), "missing_results")
            total += len(results)
            _require(total <= MAX_INPUT_RESULTS, "input_limit_exceeded")
            for result in results:
                row = _row(result, run, rules)
                by_rule[row["rule_id"]] += 1
                by_severity[(row["level"], row["security_severity"])] += 1
                _require(len(by_rule) <= MAX_RULES, "input_limit_exceeded")
                _require(len(by_severity) <= MAX_RULES, "input_limit_exceeded")
                if len(rows) < max_results:
                    rows.append(row)
    complete = (
        diagnostics["failed_invocation_count"] == 0 and diagnostics["error_count"] == 0
    )
    report = {
        "inventory_complete": True,
        "analysis_complete": complete,
        "diagnostics": dict(diagnostics),
        "count_kind": "sarif_results_not_github_open_alerts",
        "file_count": len(files),
        "run_count": runs_count,
        "result_count": total,
        "emitted_count": len(rows),
        "truncated": total > len(rows),
        "omitted_count": total - len(rows),
        "by_rule": [
            {"rule_id": key, "count": value} for key, value in sorted(by_rule.items())
        ],
        "by_severity": [
            {"level": key[0], "security_severity": key[1], "count": value}
            for key, value in sorted(
                by_severity.items(), key=lambda item: (item[0][0], item[0][1] or "")
            )
        ],
        "results": rows,
    }
    if not complete:
        report.update(error="analysis_incomplete", error_kind="scanner_diagnostics")
    return report


def main(argv: list[str] | None = None) -> int:
    parser = SafeArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    parser.add_argument("--max-results", type=int, default=500)
    args = parser.parse_args(argv)
    try:
        report = summarize(args.directory, args.max_results)
    except SummaryError as error:
        print(
            json.dumps(
                {
                    "error": str(error),
                    "error_kind": "inventory_error",
                    "analysis_complete": False,
                    "inventory_complete": False,
                }
            )
        )
        return 2
    except (OSError, TypeError, ValueError, RecursionError):
        print(
            json.dumps(
                {
                    "error": "unreadable_or_invalid_input",
                    "error_kind": "inventory_error",
                    "analysis_complete": False,
                    "inventory_complete": False,
                }
            )
        )
        return 2
    print(json.dumps(report, ensure_ascii=True, sort_keys=True))
    return 0 if report["analysis_complete"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
