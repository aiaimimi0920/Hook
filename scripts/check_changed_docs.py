"""Check changed documentation text and repository-relative link targets offline."""
import json
from pathlib import Path
import re
import subprocess
from urllib.parse import unquote, urlsplit

# Existing sibling-repository contracts cannot be checked in an Otter-only checkout.
# Restrict the exception to exact source/destination pairs; never read outside root.
SIBLING_CONTRACT_LINKS = {
    "docs/TILE_WALL_CLIENT.md": {
        "../../Loom/docs/TILE_WALL.md",
        "../../Loom/protocol/WALL_IDENTIFICATION_API.md",
    },
    "docs/TILE_TERMINAL.md": {
        "../../Loom/docs/TILE_WALL.md",
        "../../Loom/protocol/WALL_IDENTIFICATION_API.md",
        "../../Loom/protocol/WALL_TIMING_MEDIA.md",
        "../../Loom/protocol/WALL_SURFACE_API.md",
        "../../Loom/protocol/WALL_PRESENTATION_API.md",
    },
}


def markdown_destinations(text):
    """Read balanced inline link destinations, including escaped parentheses."""
    for match in re.finditer(r"\]\(\s*", text):
        start = match.end()
        if start < len(text) and text[start] == "<":
            end = text.find(">", start + 1)
            if end != -1:
                yield text[start + 1:end]
            continue
        depth, destination, index = 0, [], start
        while index < len(text):
            char = text[index]
            if char == "\\" and index + 1 < len(text):
                index += 1
                destination.append(text[index])
            elif char == "(":
                depth += 1
                destination.append(char)
            elif char == ")":
                if depth == 0:
                    break
                depth -= 1
                destination.append(char)
            elif char.isspace():
                break
            else:
                destination.append(char)
            index += 1
        if destination:
            yield "".join(destination)


def local_targets(text):
    # Exclude code fences and inline code, where illustrative paths are not links.
    text = re.sub(r"(?ms)^\s*(```|~~~).*?^\s*\1[^\n]*$", "", text)
    text = re.sub(r"`[^`\n]*`", "", text)
    links = list(markdown_destinations(text))
    links += re.findall(r'\b(?:href|src)=[\"\']([^\"\']+)[\"\']', text)
    links += re.findall(r"(?m)^\s*\[[^\]]+\]:\s*(<[^>]+>|\S+)", text)
    for link in links:
        parsed = urlsplit(link.strip("<>"))
        if not parsed.scheme and not parsed.netloc and parsed.path:
            yield unquote(parsed.path)


def check_document(root, relative):
    path = root / relative
    if not path.exists():  # A removed file has no remaining text to validate.
        return []
    errors = []
    text = path.read_text(encoding="utf-8")
    if not text.strip() or "\x00" in text:
        errors.append(f"{relative}: empty or binary documentation")
    if re.search(r"(?m)^(<{7}|>{7})(?: |$)", text):
        errors.append(f"{relative}: unresolved conflict marker")
    for target in local_targets(text):
        if target in SIBLING_CONTRACT_LINKS.get(relative, set()):
            continue
        resolved = (root / target.lstrip("/") if target.startswith("/") else path.parent / target).resolve()
        if not resolved.is_relative_to(root) or not resolved.exists():
            errors.append(f"{relative}: missing or out-of-repository link: {target}")
    return errors


def main():
    scope = json.loads(Path(".ci-change-scope.json").read_text(encoding="utf-8"))
    if not scope["docs_only"]:
        return
    root = Path.cwd().resolve()
    subprocess.run(["git", "diff", "--check", scope["base"], scope["head"], "--"], check=True)
    errors = []
    for path in scope["paths"]:
        if path.endswith(".md") or path == "LICENSE":
            errors.extend(check_document(root, path))
    # Deletions/renames must not leave incoming links in unchanged documents.
    removed = {(root / p).resolve() for p in scope["paths"] if not (root / p).exists()}
    if removed:
        files = subprocess.check_output(["git", "ls-files", "-z", "*.md"]).split(b"\0")
        for item in files:
            if not item:
                continue
            path = root / item.decode("utf-8")
            for target in local_targets(path.read_text(encoding="utf-8")):
                resolved = (root / target.lstrip("/") if target.startswith("/") else path.parent / target).resolve()
                if resolved in removed:
                    errors.append(f"{path.relative_to(root)}: link to removed document: {target}")
    if errors:
        raise SystemExit("\n".join(errors))
    print("Changed documentation: UTF-8, conflict markers, whitespace and local link paths passed")
    print("External URLs, anchors and allowlisted sibling contract links are not locally validated")


if __name__ == "__main__":
    main()
