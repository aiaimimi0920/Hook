"""Synthetic, offline coverage of the source-text-free SARIF inventory."""

from __future__ import annotations

import json
from copy import deepcopy
from pathlib import Path

import pytest

from scripts import summarize_codeql_results as summary



def _result(rule_id: str = "py/incomplete-url-substring-sanitization") -> dict:
    return {
        "ruleId": rule_id,
        "message": {
            "text": "SYNTHETIC_PRIVATE_MESSAGE https://secret.invalid/?token=PRIVATE"
        },
        "locations": [
            {
                "physicalLocation": {
                    "artifactLocation": {
                        "uri": "src/example.py",
                        "uriBaseId": "%SRCROOT%",
                    },
                    "region": {
                        "startLine": 12,
                        "snippet": {"text": "SYNTHETIC_PRIVATE_SNIPPET"},
                    },
                }
            }
        ],
        "codeFlows": [{"message": {"text": "SYNTHETIC_PRIVATE_FLOW"}}],
        "partialFingerprints": {"secret": "SYNTHETIC_PRIVATE_FINGERPRINT"},
    }


def _payload(results: list | None = None) -> dict:
    return {
        "version": "2.1.0",
        "runs": [
            {
                "tool": {
                    "driver": {
                        "name": "CodeQL",
                        "rules": [
                            {
                                "id": "py/incomplete-url-substring-sanitization",
                                "properties": {"security-severity": "7.8"},
                                "defaultConfiguration": {"level": "warning"},
                                "fullDescription": {
                                    "text": "SYNTHETIC_PRIVATE_DESCRIPTION"
                                },
                            }
                        ],
                    }
                },
                "invocations": [{"executionSuccessful": True}],
                "results": [_result()] if results is None else results,
            }
        ],
    }


def _write(directory: Path, payload: dict, name: str = "python.sarif") -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / name
    path.write_text(json.dumps(payload), encoding="utf-8")
    return path


def test_only_allowlisted_fields_are_emitted(tmp_path: Path) -> None:
    _write(tmp_path, _payload())
    report = summary.summarize(tmp_path)
    assert report["results"] == [
        {
            "rule_id": "py/incomplete-url-substring-sanitization",
            "path": "src/example.py",
            "line": 12,
            "level": "warning",
            "security_severity": "7.8",
        }
    ]
    text = json.dumps(report)
    for private in ("SYNTHETIC_PRIVATE", "https://", "token=", str(tmp_path)):
        assert private not in text
    assert report["count_kind"] == "sarif_results_not_github_open_alerts"


def test_multiple_files_runs_and_truncation_count_every_result(tmp_path: Path) -> None:
    payload = _payload([_result(), _result()])
    payload["runs"].append(deepcopy(payload["runs"][0]))
    _write(tmp_path, payload)
    _write(tmp_path / "nested", _payload(), "javascript.sarif")
    report = summary.summarize(tmp_path, max_results=2)
    assert (report["file_count"], report["run_count"], report["result_count"]) == (
        2,
        3,
        5,
    )
    assert (report["emitted_count"], report["omitted_count"], report["truncated"]) == (
        2,
        3,
        True,
    )
    assert report["by_rule"] == [{"rule_id": _result()["ruleId"], "count": 5}]
    assert report["by_severity"] == [
        {"level": "warning", "security_severity": "7.8", "count": 5}
    ]


def test_empty_results_are_valid_and_parse_warnings_are_not_failures(
    tmp_path: Path,
) -> None:
    payload = _payload([])
    payload["runs"][0]["invocations"][0]["toolExecutionNotifications"] = [
        {"level": "warning", "message": {"text": "PRIVATE"}}
    ]
    _write(tmp_path, payload)
    report = summary.summarize(tmp_path)
    assert report["result_count"] == 0
    assert report["results"] == []
    assert report["truncated"] is False


@pytest.mark.parametrize(
    "notification",
    [None, "toolExecutionNotifications", "toolConfigurationNotifications"],
)
def test_failed_execution_never_produces_complete_zero(
    tmp_path: Path, capsys: pytest.CaptureFixture, notification: str | None
) -> None:
    payload = _payload([])
    invocation = payload["runs"][0]["invocations"][0]
    if notification:
        invocation[notification] = [{"level": "error", "message": {"text": "PRIVATE"}}]
    else:
        invocation["executionSuccessful"] = False
    _write(tmp_path, payload)
    assert summary.main([str(tmp_path)]) == 2
    report = json.loads(capsys.readouterr().out)
    assert report["analysis_complete"] is False
    assert report["inventory_complete"] is True
    assert report["result_count"] == 0
    assert report["error_kind"] == "scanner_diagnostics"
    assert report["diagnostics"]["error_count"] == (1 if notification else 0)
    assert report["diagnostics"]["failed_invocation_count"] == (
        0 if notification else 1
    )


@pytest.mark.parametrize(
    "field,value", [("runs", []), ("runs", None), ("version", "1.0")]
)
def test_invalid_document_is_an_error(
    tmp_path: Path, field: str, value: object
) -> None:
    payload = _payload()
    payload[field] = value
    _write(tmp_path, payload)
    with pytest.raises(summary.SummaryError):
        summary.summarize(tmp_path)


def test_missing_results_is_an_error(tmp_path: Path) -> None:
    payload = _payload()
    del payload["runs"][0]["results"]
    _write(tmp_path, payload)
    with pytest.raises(summary.SummaryError, match="^missing_results$"):
        summary.summarize(tmp_path)


@pytest.mark.parametrize(
    "uri",
    [
        "/home/private/example.py",
        "file:///home/private/example.py",
        "https://secret.invalid/file.py",
        "../private.py",
        "src/../private.py",
        "src/%2e%2e/private.py",
        "src/%252e%252e/private.py",
        "C:/private.py",
        "src\\private.py",
        "src/file.py?token=PRIVATE",
        "src/file.py#PRIVATE",
        "src/%00private.py",
        "src/%FF.py",
        "src//private.py",
        "src/./private.py",
        "x" * 2049,
    ],
)
def test_unsafe_locations_are_rejected(tmp_path: Path, uri: str) -> None:
    payload = _payload()
    payload["runs"][0]["results"][0]["locations"][0]["physicalLocation"][
        "artifactLocation"
    ]["uri"] = uri
    _write(tmp_path, payload)
    with pytest.raises(summary.SummaryError, match="^invalid_location$"):
        summary.summarize(tmp_path)


@pytest.mark.parametrize("line", [True, 0, -1, 1.2, "12", 10_000_001])
def test_invalid_line_is_rejected(tmp_path: Path, line: object) -> None:
    payload = _payload()
    payload["runs"][0]["results"][0]["locations"][0]["physicalLocation"]["region"][
        "startLine"
    ] = line
    _write(tmp_path, payload)
    with pytest.raises(summary.SummaryError, match="^invalid_location$"):
        summary.summarize(tmp_path)


@pytest.mark.parametrize(
    "identifier",
    ["https://secret.invalid", "py/test?token=PRIVATE", "x" * 161, True, None],
)
def test_invalid_rule_identifiers_are_rejected(
    tmp_path: Path, identifier: object
) -> None:
    payload = _payload()
    payload["runs"][0]["results"][0]["ruleId"] = identifier
    _write(tmp_path, payload)
    with pytest.raises(summary.SummaryError):
        summary.summarize(tmp_path)


@pytest.mark.parametrize(
    "severity", [True, "SECRET", "https://secret.invalid", "NaN", 11, -1, {}]
)
def test_invalid_security_severity_is_rejected(
    tmp_path: Path, severity: object
) -> None:
    payload = _payload()
    payload["runs"][0]["tool"]["driver"]["rules"][0]["properties"][
        "security-severity"
    ] = severity
    _write(tmp_path, payload)
    with pytest.raises(summary.SummaryError):
        summary.summarize(tmp_path)


def test_rule_and_artifact_indexes_and_level_override(tmp_path: Path) -> None:
    payload = _payload()
    run = payload["runs"][0]
    result = run["results"][0]
    del result["ruleId"]
    result.update(ruleIndex=0, level="error")
    result["locations"][0]["physicalLocation"]["artifactLocation"] = {"index": 0}
    run["artifacts"] = [{"location": {"uri": "src/my%20file.py"}}]
    _write(tmp_path, payload)
    row = summary.summarize(tmp_path)["results"][0]
    assert row["path"] == "src/my file.py"
    assert row["level"] == "error"


def test_invalid_result_after_output_cap_still_fails(tmp_path: Path) -> None:
    payload = _payload([_result(), _result()])
    payload["runs"][0]["results"][1]["ruleId"] = "PRIVATE"
    _write(tmp_path, payload)
    with pytest.raises(summary.SummaryError):
        summary.summarize(tmp_path, max_results=1)


@pytest.mark.parametrize("limit", [0, -1, True, 5001])
def test_invalid_output_limit_is_rejected(tmp_path: Path, limit: int) -> None:
    with pytest.raises(summary.SummaryError, match="^invalid_output_limit$"):
        summary.summarize(tmp_path, max_results=limit)


@pytest.mark.parametrize(
    "limit",
    [
        "MAX_FILES",
        "MAX_FILE_BYTES",
        "MAX_TOTAL_BYTES",
        "MAX_RUNS",
        "MAX_INPUT_RESULTS",
        "MAX_RULES",
        "MAX_DIRECTORY_ENTRIES",
    ],
)
def test_input_limits_fail_without_incomplete_counts(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, limit: str
) -> None:
    _write(tmp_path, _payload())
    monkeypatch.setattr(summary, limit, 0)
    with pytest.raises(summary.SummaryError):
        summary.summarize(tmp_path)


def test_symlink_input_is_rejected(tmp_path: Path) -> None:
    source = _write(tmp_path / "source", _payload())
    target = tmp_path / "input"
    target.mkdir()
    (target / "link.sarif").symlink_to(source)
    with pytest.raises(summary.SummaryError, match="^unsafe_input$"):
        summary.summarize(target)


@pytest.mark.parametrize("contents", [None, "not JSON PRIVATE", "{}"])
def test_cli_errors_never_include_input_data(
    tmp_path: Path, capsys: pytest.CaptureFixture, contents: str | None
) -> None:
    if contents is not None:
        (tmp_path / "PRIVATE.sarif").write_text(contents)
    assert summary.main([str(tmp_path)]) == 2
    captured = capsys.readouterr()
    report = json.loads(captured.out)
    assert set(report) == {
        "error",
        "error_kind",
        "analysis_complete",
        "inventory_complete",
    }
    assert report["error_kind"] == "inventory_error"
    assert report["analysis_complete"] is report["inventory_complete"] is False
    assert not captured.err
    assert "PRIVATE" not in captured.out
    assert str(tmp_path) not in captured.out


def test_cli_bad_argument_does_not_echo_value(capsys: pytest.CaptureFixture) -> None:
    with pytest.raises(SystemExit) as error:
        summary.main(["PRIVATE", "--max-results", "PRIVATE_TOKEN"])
    assert error.value.code == 2
    captured = capsys.readouterr()
    assert json.loads(captured.out) == {"error": "invalid_arguments"}
    assert not captured.err


def test_cli_findings_are_successful_diagnostics(
    tmp_path: Path, capsys: pytest.CaptureFixture
) -> None:
    _write(tmp_path, _payload())
    assert summary.main([str(tmp_path)]) == 0
    assert json.loads(capsys.readouterr().out)["result_count"] == 1


def _extension_payload() -> dict:
    payload = _payload()
    run = payload["runs"][0]
    rules = run["tool"]["driver"].pop("rules")
    run["tool"]["extensions"] = [
        {
            "name": "codeql/python-queries",
            "guid": "11111111-1111-1111-1111-111111111111",
            "rules": rules,
        }
    ]
    run["results"][0]["rule"] = {
        "id": rules[0]["id"],
        "index": 0,
        "toolComponent": {"index": 0, "name": "codeql/python-queries"},
    }
    return payload


@pytest.mark.parametrize("reference_type", ["index", "component_guid", "rule_guid"])
def test_extension_rule_metadata_is_resolved(
    tmp_path: Path, reference_type: str
) -> None:
    payload = _extension_payload()
    run = payload["runs"][0]
    reference = run["results"][0]["rule"]
    if reference_type == "component_guid":
        reference["toolComponent"] = {"guid": run["tool"]["extensions"][0]["guid"]}
    if reference_type == "rule_guid":
        del reference["index"]
        reference["guid"] = "22222222-2222-2222-2222-222222222222"
        run["tool"]["extensions"][0]["rules"][0]["guid"] = reference["guid"]
    _write(tmp_path, payload)
    row = summary.summarize(tmp_path)["results"][0]
    assert row["security_severity"] == "7.8"
    assert row["rule_id"] == _result()["ruleId"]


def test_extension_rule_id_can_come_only_from_reference(tmp_path: Path) -> None:
    payload = _extension_payload()
    del payload["runs"][0]["results"][0]["ruleId"]
    _write(tmp_path, payload)
    assert summary.summarize(tmp_path)["results"][0]["security_severity"] == "7.8"


def test_same_rule_id_in_different_components_uses_explicit_component(
    tmp_path: Path,
) -> None:
    payload = _extension_payload()
    run = payload["runs"][0]
    run["tool"]["driver"]["rules"] = deepcopy(run["tool"]["extensions"][0]["rules"])
    run["tool"]["driver"]["rules"][0]["properties"]["security-severity"] = "1.2"
    _write(tmp_path, payload)
    assert summary.summarize(tmp_path)["results"][0]["security_severity"] == "7.8"


@pytest.mark.parametrize(
    "field,value",
    [
        ("index", -1),
        ("index", 1),
        ("index", True),
        ("name", "PRIVATE"),
        ("guid", "PRIVATE"),
    ],
)
def test_bad_component_reference_is_an_inventory_error(
    tmp_path: Path, field: str, value: object
) -> None:
    payload = _extension_payload()
    payload["runs"][0]["results"][0]["rule"]["toolComponent"][field] = value
    _write(tmp_path, payload)
    with pytest.raises(summary.SummaryError, match="^invalid_rules$"):
        summary.summarize(tmp_path)


@pytest.mark.parametrize(
    "field,value",
    [("index", True), ("index", 1), ("index", -1), ("index", "0"), ("id", "py/redos")],
)
def test_conflicting_rule_reference_is_rejected(
    tmp_path: Path, field: str, value: object
) -> None:
    payload = _extension_payload()
    payload["runs"][0]["results"][0]["rule"][field] = value
    _write(tmp_path, payload)
    with pytest.raises(summary.SummaryError, match="^invalid_rules$"):
        summary.summarize(tmp_path)


def test_top_level_and_nested_rule_indexes_must_agree(tmp_path: Path) -> None:
    payload = _extension_payload()
    payload["runs"][0]["results"][0]["ruleIndex"] = 1
    _write(tmp_path, payload)
    with pytest.raises(summary.SummaryError, match="^invalid_rules$"):
        summary.summarize(tmp_path)


def test_mixed_invocations_preserve_findings_and_only_diagnostic_counts(
    tmp_path: Path, capsys: pytest.CaptureFixture
) -> None:
    payload = _extension_payload()
    payload["runs"][0]["invocations"].append(
        {
            "executionSuccessful": False,
            "commandLine": "PRIVATE_TOKEN",
            "toolExecutionNotifications": [
                {
                    "level": "error",
                    "message": {
                        "text": "PRIVATE_TOKEN https://private.invalid/?token=SECRET"
                    },
                    "locations": [
                        {
                            "physicalLocation": {
                                "artifactLocation": {"uri": "/home/private/source.py"},
                                "region": {"snippet": {"text": "PRIVATE_SNIPPET"}},
                            }
                        }
                    ],
                    "exception": {"message": "PRIVATE_EXCEPTION"},
                },
                {"level": "warning", "message": {"text": "PRIVATE_WARNING"}},
            ],
        }
    )
    _write(tmp_path, payload)
    assert summary.main([str(tmp_path)]) == 2
    captured = capsys.readouterr()
    report = json.loads(captured.out)
    assert report["inventory_complete"] is True
    assert report["analysis_complete"] is False
    assert report["result_count"] == 1
    assert report["results"][0]["security_severity"] == "7.8"
    assert report["diagnostics"] == {
        "invocation_count": 2,
        "failed_invocation_count": 1,
        "notification_count": 2,
        "error_count": 1,
        "warning_count": 1,
        "note_count": 0,
        "none_count": 0,
    }
    for private in ("PRIVATE", "https://", "token=", "/home", str(tmp_path)):
        assert private not in captured.out
    assert captured.err == ""


@pytest.mark.parametrize("status", [None, "false", 0, [], {}])
def test_malformed_execution_status_is_not_a_scanner_failure(
    tmp_path: Path, status: object
) -> None:
    payload = _payload()
    payload["runs"][0]["invocations"][0]["executionSuccessful"] = status
    _write(tmp_path, payload)
    with pytest.raises(summary.SummaryError, match="^invalid_execution_status$"):
        summary.summarize(tmp_path)


def test_mixed_runs_and_files_preserve_all_available_findings(tmp_path: Path) -> None:
    payload = _payload()
    payload["runs"].append(deepcopy(payload["runs"][0]))
    payload["runs"][1]["invocations"][0]["executionSuccessful"] = False
    _write(tmp_path, payload)
    _write(tmp_path, _payload(), "second.sarif")
    report = summary.summarize(tmp_path, max_results=1)
    assert report["result_count"] == 3
    assert report["analysis_complete"] is False
    assert report["inventory_complete"] is True
    assert report["omitted_count"] == 2


def test_invalid_result_with_scanner_errors_remains_inventory_failure(
    tmp_path: Path, capsys: pytest.CaptureFixture
) -> None:
    payload = _payload()
    payload["runs"][0]["invocations"][0]["executionSuccessful"] = False
    payload["runs"][0]["results"][0]["ruleId"] = "PRIVATE"
    _write(tmp_path, payload)
    assert summary.main([str(tmp_path)]) == 2
    report = json.loads(capsys.readouterr().out)
    assert report["error_kind"] == "inventory_error"
    assert report["inventory_complete"] is False
    assert "result_count" not in report


@pytest.mark.parametrize("limit", ["MAX_COMPONENTS", "MAX_DIAGNOSTICS"])
def test_component_and_diagnostic_limits(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, limit: str
) -> None:
    _write(tmp_path, _extension_payload())
    monkeypatch.setattr(summary, limit, 0)
    with pytest.raises(summary.SummaryError):
        summary.summarize(tmp_path)
