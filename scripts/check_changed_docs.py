"""Check changed documentation text and repository-relative link targets offline."""
import json
import os
from html import unescape
from html.parser import HTMLParser
from pathlib import Path
import re
import subprocess
from urllib.parse import unquote, urlsplit

# Existing sibling-repository contracts cannot be checked in an Otter-only checkout.
# Restrict the exception to exact source/destination pairs; never read outside root.
SIBLING_CONTRACT_LINKS = {
    "docs/features/TILE_WALL_CLIENT.md": {
        "../../../Loom/docs/TILE_WALL.md",
        "../../../Loom/protocol/WALL_IDENTIFICATION_API.md",
    },
    "docs/features/TILE_TERMINAL.md": {
        "../../../Loom/docs/TILE_WALL.md",
        "../../../Loom/protocol/WALL_IDENTIFICATION_API.md",
        "../../../Loom/protocol/WALL_TIMING_MEDIA.md",
        "../../../Loom/protocol/WALL_SURFACE_API.md",
        "../../../Loom/protocol/WALL_PRESENTATION_API.md",
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
        for name, value in attrs:
            if value is None:
                continue
            if name in {"href", "src"}:
                self.links.append(value)
            elif name == "srcset":
                self.links.extend(srcset_destinations(value))

    handle_startendtag = handle_starttag


def srcset_destinations(value):
    """Read URL tokens without splitting commas embedded in data URLs."""
    while value:
        value = value.lstrip(" \t\r\n\f,")
        if not value:
            return
        match = re.match(r"\S+", value)
        token = match.group()
        yield token.rstrip(",")
        value = value[match.end():]
        if token.endswith(","):
            continue
        # Skip descriptors; parentheses may contain commas.
        depth, index = 0, 0
        while index < len(value):
            char = value[index]
            if char == "(":
                depth += 1
            elif char == ")":
                depth = max(0, depth - 1)
            elif char == "," and depth == 0:
                break
            index += 1
        value = value[index + 1:]


def rendered_text(text):
    """Exclude comments and code while preserving indented list paragraphs."""
    text = re.sub(r"<!--[\s\S]*?(?:-->|$)", "", text)
    lines, in_code, previous_blank = [], False, True
    list_indents, fence = [], None
    for line in text.splitlines(keepends=True):
        expanded = line.expandtabs(4)
        indent = len(expanded) - len(expanded.lstrip(" "))
        blank = not expanded.strip()
        marker = re.match(r"^( *)(?:[-+*]|\d+[.)]) +(?!$)", expanded)
        if not blank:
            while list_indents and indent < list_indents[-1]:
                list_indents.pop()
        if marker and not fence:
            list_indents.append(marker.end())
        container_indent = list_indents[-1] if list_indents else 0
        content = expanded[container_indent:] if indent >= container_indent else expanded
        if fence:
            # CommonMark permits a longer closing run of the same character.
            if re.fullmatch(r" {0,3}" + re.escape(fence[0]) +
                            r"{" + str(fence[1]) + r",}[ \t]*(?:\n)?", content):
                fence = None
            lines.append("\n")
            previous_blank = blank
            continue
        opening = re.match(r"^ {0,3}(`{3,}|~{3,})(.*)$", content)
        if opening and not (opening[1][0] == "`" and "`" in opening[2]):
            fence = (opening[1][0], len(opening[1]))
            lines.append("\n")
            in_code = False
        elif indent - container_indent >= 4 and (previous_blank or in_code):
            in_code = True
            lines.append("\n")
        elif in_code and blank:
            lines.append("\n")
        else:
            in_code = False
            lines.append(line)
        previous_blank = blank
    return "".join(lines)


def local_targets(text):
    # Exclude code fences and inline code, where illustrative paths are not links.
    text = rendered_text(text)
    text = re.sub(r"(?<!`)(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)", "", text)
    links = [unescape(link) for link in markdown_destinations(text)]
    html = HtmlDestinations()
    html.feed(text)
    links += html.links
    links += [unescape(link) for link in
              re.findall(r"(?m)^ {0,3}\[(?!\^)[^\]]+\]:\s*(<[^>]+>|\S+)", text)]
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
        if target.startswith("/"):
            errors.append(f"{relative}: domain-root link is not repository-relative: {target}")
            continue
        resolved = Path(os.path.abspath(path.parent / target))
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
                resolved = Path(os.path.abspath(path.parent / target))
                affected = any(p == resolved or resolved in p.parents for p in removed)
                if affected and not target_exists(root, resolved, tracked):
                    errors.append(f"{relative}: link to removed document or directory: {target}")
    if errors:
        raise SystemExit("\n".join(errors))
    print("Changed documentation: UTF-8, conflict markers, whitespace and local link paths passed")
    print("External URLs, anchors and allowlisted sibling contract links are not locally validated")


if __name__ == "__main__":
    main()
