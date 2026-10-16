"""Fail closed: only known prose and documentation images can skip product CI."""
import json
import os
from pathlib import PurePosixPath, Path
import re
import subprocess

ROOT_DOCS = {"README.md", "README.zh-CN.md", "CONTRIBUTING.md", "AGENTS.md",
             "docs/architecture/overview.md", "CHANGELOG.md", "GOVERNANCE.md",
             "SECURITY.md", "docs/development/standalone-migration.md", "THIRD_PARTY_NOTICES.md",
             "docs/release/uiaccess-distribution.md"}
IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp"}


def is_documentation(path):
    parts = PurePosixPath(path).parts
    if not parts or path.startswith("/") or ".." in parts or "\\" in path:
        return False
    if path in ROOT_DOCS:
        return True
    # Release input and the hero asset retain their existing full-product contracts.
    if path in {"docs/release/GITHUB_RELEASE_BODY.md", "docs/assets/github-home-hero.svg"}:
        return False
    return (path.startswith("docs/") and path.endswith(".md")) or (
        path.startswith("docs/assets/") and PurePosixPath(path).suffix in IMAGE_SUFFIXES)


def git(*args):
    return subprocess.check_output(["git", *args], stderr=subprocess.PIPE, timeout=30)


def changed_paths(event_name, event):
    """Compare immutable event commits, never shell-interpolate branch names."""
    if event_name == "pull_request":
        base = event["pull_request"]["base"]["sha"]
        head = event["pull_request"]["head"]["sha"]
    elif event_name == "push" and not event.get("created") and not event.get("deleted"):
        base, head = event["before"], event["after"]
    else:
        raise ValueError("Manual, new-branch or unknown events require full CI")
    for sha in (base, head):
        if not isinstance(sha, str) or not re.fullmatch(r"[0-9a-f]{40}", sha) or sha == "0" * 40:
            raise ValueError("Missing or invalid event commit")
        git("cat-file", "-e", sha + "^{commit}")
    if event_name == "pull_request":
        base = git("merge-base", base, head).decode("ascii").strip()
    # Disable rename detection so both the old and new names are classified.
    raw = git("diff", "--name-only", "--no-renames", "-z", base, head, "--")
    paths = [p.decode("utf-8") for p in raw.split(b"\0") if p]
    # Symlinks/submodules are not documentation, even with a Markdown filename.
    regular = True
    for revision in (base, head):
        entries = git("ls-tree", "-r", "-z", revision).split(b"\0")
        modes = {}
        for entry in entries:
            if entry:
                meta, path = entry.split(b"\t", 1)
                modes[path.decode("utf-8")] = meta.split(b" ")[0]
        regular = regular and all(modes.get(p, b"100644") == b"100644" for p in paths)
    return paths, regular, base, head


def classify(event_name, event):
    try:
        paths, regular, base, head = changed_paths(event_name, event)
        docs_only = bool(paths) and regular and all(map(is_documentation, paths))
        return {"docs_only": docs_only, "paths": paths, "base": base, "head": head}
    except (KeyError, TypeError, ValueError, UnicodeError, OSError, subprocess.SubprocessError):
        return {"docs_only": False, "paths": [], "base": "", "head": ""}


def main():
    try:
        event = json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text(encoding="utf-8"))
    except (KeyError, ValueError, OSError):
        event = {}
    result = classify(os.environ.get("GITHUB_EVENT_NAME", ""), event)
    Path(".ci-change-scope.json").write_text(json.dumps(result), encoding="utf-8")
    full = str(not result["docs_only"]).lower()
    with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as output:
        output.write(f"full={full}\n")
    print("Documentation-only checks" if result["docs_only"] else "Full product checks required")


if __name__ == "__main__":
    main()
