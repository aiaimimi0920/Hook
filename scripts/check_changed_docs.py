"""Check changed documentation text and repository-relative link targets offline."""
import json
import os
from html.parser import HTMLParser
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


class HtmlDestinations(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.links = []

    def handle_starttag(self, tag, attrs):
        self.links.extend(value for name, value in attrs
                          if name in {"href", "src"} and value is not None)

    handle_startendtag = handle_starttag


def local_targets(text):
    # Exclude code fences and inline code, where illustrative paths are not links.
    text = re.sub(r"(?ms)^\s*(```|~~~).*?^\s*\1[^\n]*$", "", text)
    text = re.sub(r"(?<!`)(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)", "", text)
    links = list(markdown_destinations(text))
    html = HtmlDestinations()
    html.feed(text)
    links += html.links
    links += re.findall(r"(?m)^\s*\[(?!\^)[^\]]+\]:\s*(<[^>]+>|\S+)", text)
    for link in links:
        parsed = urlsplit(link.strip("<>"))
        if not parsed.scheme and not parsed.netloc and parsed.path:
            yield unquote(parsed.path)


def target_exists(root, resolved, tracked):
    if not resolved.resolve().is_relative_to(root) or not resolved.exists():
        return False
    if tracked is None:  # Standalone text checks may use an explicit file fixture.
        return True
    relative = resolved.relative_to(root).as_posix()
    return relative == "." or relative in tracked or any(
        name.startswith(relative.rstrip("/") + "/") for name in tracked)


def check_document(root, relative, tracked=None):
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
        resolved = Path(os.path.abspath(root / target.lstrip("/") if target.startswith("/") else path.parent / target))
        if not target_exists(root, resolved, tracked):
            errors.append(f"{relative}: missing or out-of-repository link: {target}")
    return errors


def main():
    scope = json.loads(Path(".ci-change-scope.json").read_text(encoding="utf-8"))
    if not scope["docs_only"]:
        return
    root = Path.cwd().resolve()
    subprocess.run(["git", "diff", "--check", scope["base"], scope["head"], "--"], check=True)
    tracked = {p.decode("utf-8") for p in
               subprocess.check_output(["git", "ls-tree", "-r", "--name-only", "-z", "HEAD"]).split(b"\0") if p}
    errors = []
    for path in scope["paths"]:
        if path.endswith(".md") or path == "LICENSE":
            errors.extend(check_document(root, path, tracked))
    # Deleted paths can invalidate links to their now-empty parent directories.
    removed = {(root / p).resolve() for p in scope["paths"] if not (root / p).exists()}
    if removed:
        for relative in sorted(p for p in tracked if p.endswith(".md")):
            path = root / relative
            for target in local_targets(path.read_text(encoding="utf-8")):
                if target in SIBLING_CONTRACT_LINKS.get(relative, set()):
                    continue
                resolved = Path(os.path.abspath(root / target.lstrip("/") if target.startswith("/") else path.parent / target))
                affected = any(p == resolved or resolved in p.parents for p in removed)
                if affected and not target_exists(root, resolved, tracked):
                    errors.append(f"{relative}: link to removed document or directory: {target}")
    if errors:
        raise SystemExit("\n".join(errors))
    print("Changed documentation: UTF-8, conflict markers, whitespace and local link paths passed")
    print("External URLs, anchors and allowlisted sibling contract links are not locally validated")


if __name__ == "__main__":
    main()
