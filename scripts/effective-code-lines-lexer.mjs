import { TextDecoder } from "node:util";

const LANGUAGE_BY_EXTENSION = new Map([
  [".rs", "rust"],
  [".ts", "c-like"],
  [".tsx", "c-like"],
  [".js", "c-like"],
  [".jsx", "c-like"],
  [".mjs", "c-like"],
  [".cjs", "c-like"],
  [".css", "css"],
  [".scss", "css"],
  [".html", "html"],
  [".htm", "html"],
  [".ps1", "powershell"],
  [".py", "python"],
  [".cmd", "cmd"],
  [".bat", "cmd"],
]);

export const SUPPORTED_EXTENSIONS = Object.freeze([...LANGUAGE_BY_EXTENSION.keys()]);

export function languageForExtension(extension) {
  return LANGUAGE_BY_EXTENSION.get(extension.toLowerCase());
}

export function decodeUtf8(bytes, sourceName = "source") {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, "");
  } catch (error) {
    throw new Error(`${sourceName} is not valid UTF-8: ${error.message}`);
  }
}

function sourceLines(source) {
  if (source.length === 0) return [];
  const lines = source.split(/\r\n|\n|\r/);
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

export function countPhysicalLines(source) {
  return sourceLines(source).length;
}

function countCommandLines(lines) {
  return lines.reduce((count, line) => {
    const value = line.trim();
    return count + (value && !/^@?rem(?:\s|$)/i.test(value) && !/^::/.test(value) ? 1 : 0);
  }, 0);
}

function countHtmlLines(lines) {
  let inComment = false;
  let count = 0;
  for (const line of lines) {
    let cursor = 0;
    let hasCode = false;
    while (cursor < line.length) {
      if (inComment) {
        const end = line.indexOf("-->", cursor);
        if (end < 0) break;
        inComment = false;
        cursor = end + 3;
        continue;
      }
      const start = line.indexOf("<!--", cursor);
      const fragment = start < 0 ? line.slice(cursor) : line.slice(cursor, start);
      if (/\S/.test(fragment)) hasCode = true;
      if (start < 0) break;
      inComment = true;
      cursor = start + 4;
    }
    if (hasCode) count += 1;
  }
  return count;
}

function rustRawStringStart(line, cursor) {
  const match = /^(?:br|r)(#{0,255})"/.exec(line.slice(cursor));
  if (!match) return undefined;
  return { length: match[0].length, terminator: `"${match[1]}` };
}

function rustLifetimeAt(line, cursor) {
  if (line[cursor] !== "'") return false;
  const tail = line.slice(cursor);
  return /^'[A-Za-z_][A-Za-z0-9_]*(?::|\b)/.test(tail) && !/^'.'/.test(tail);
}

function countCLikeLines(lines, language) {
  const supportsLineComments = language !== "css";
  const nestedBlockComments = language === "rust";
  let blockDepth = 0;
  let quote;
  let rawTerminator;
  let count = 0;

  for (const line of lines) {
    let cursor = 0;
    let escaped = false;
    let hasCode = false;
    while (cursor < line.length) {
      if (rawTerminator) {
        const end = line.indexOf(rawTerminator, cursor);
        if (end < 0) {
          if (/\S/.test(line.slice(cursor))) hasCode = true;
          break;
        }
        hasCode = true;
        cursor = end + rawTerminator.length;
        rawTerminator = undefined;
        continue;
      }
      if (blockDepth > 0) {
        if (nestedBlockComments && line.startsWith("/*", cursor)) {
          blockDepth += 1;
          cursor += 2;
        } else if (line.startsWith("*/", cursor)) {
          blockDepth -= 1;
          cursor += 2;
        } else {
          cursor += 1;
        }
        continue;
      }
      if (quote) {
        hasCode = true;
        const character = line[cursor];
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === quote) quote = undefined;
        cursor += 1;
        continue;
      }
      if (language === "rust") {
        const raw = rustRawStringStart(line, cursor);
        if (raw) {
          hasCode = true;
          rawTerminator = raw.terminator;
          cursor += raw.length;
          continue;
        }
      }
      if (line.startsWith("/*", cursor)) {
        blockDepth = 1;
        cursor += 2;
        continue;
      }
      if (supportsLineComments && line.startsWith("//", cursor)) break;
      const character = line[cursor];
      if (language === "rust" && rustLifetimeAt(line, cursor)) {
        hasCode = true;
        cursor += 1;
        continue;
      }
      if (character === "'" || character === '"' || (language === "c-like" && character === "`")) {
        hasCode = true;
        quote = character;
        cursor += 1;
        continue;
      }
      if (/\S/.test(character)) hasCode = true;
      cursor += 1;
    }
    if (hasCode) count += 1;
    if (quote !== "`" && escaped) {
      quote = undefined;
      escaped = false;
    }
  }
  return count;
}

function countPowerShellLines(lines) {
  let inBlockComment = false;
  let quote;
  let hereEnd;
  let count = 0;
  for (const line of lines) {
    if (hereEnd) {
      if (line.trim() === hereEnd) hereEnd = undefined;
      if (line.trim()) count += 1;
      continue;
    }
    let cursor = 0;
    let escaped = false;
    let hasCode = false;
    while (cursor < line.length) {
      if (inBlockComment) {
        const end = line.indexOf("#>", cursor);
        if (end < 0) break;
        inBlockComment = false;
        cursor = end + 2;
        continue;
      }
      if (quote) {
        hasCode = true;
        const character = line[cursor];
        if (quote === "'" && character === "'" && line[cursor + 1] === "'") {
          cursor += 2;
          continue;
        }
        if (escaped) escaped = false;
        else if (quote === '"' && character === "`") escaped = true;
        else if (character === quote) quote = undefined;
        cursor += 1;
        continue;
      }
      if (line.startsWith("<#", cursor)) {
        inBlockComment = true;
        cursor += 2;
        continue;
      }
      if (line[cursor] === "#") break;
      const here = /^@(['"])\s*$/.exec(line.slice(cursor));
      if (here) {
        hasCode = true;
        hereEnd = `${here[1]}@`;
        break;
      }
      if (line[cursor] === "'" || line[cursor] === '"') {
        hasCode = true;
        quote = line[cursor];
      } else if (/\S/.test(line[cursor])) {
        hasCode = true;
      }
      cursor += 1;
    }
    if (hasCode) count += 1;
  }
  return count;
}

function countPythonLines(lines) {
  let triple;
  let tripleIsDoc = false;
  let canStartDoc = true;
  let count = 0;
  for (const line of lines) {
    let cursor = 0;
    let quote;
    let escaped = false;
    let hasCode = false;
    while (cursor < line.length) {
      if (triple) {
        const end = line.indexOf(triple, cursor);
        if (!tripleIsDoc && /\S/.test(end < 0 ? line.slice(cursor) : line.slice(cursor, end))) hasCode = true;
        if (end < 0) break;
        if (!tripleIsDoc) hasCode = true;
        cursor = end + 3;
        triple = undefined;
        tripleIsDoc = false;
        continue;
      }
      if (quote) {
        hasCode = true;
        const character = line[cursor];
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === quote) quote = undefined;
        cursor += 1;
        continue;
      }
      if (line[cursor] === "#") break;
      const tripleStart = line.slice(cursor, cursor + 3);
      if (tripleStart === "'''" || tripleStart === '\"\"\"') {
        triple = tripleStart;
        tripleIsDoc = canStartDoc && !hasCode && !/\S/.test(line.slice(0, cursor));
        if (!tripleIsDoc) hasCode = true;
        cursor += 3;
        continue;
      }
      if (line[cursor] === "'" || line[cursor] === '"') {
        hasCode = true;
        quote = line[cursor];
      } else if (/\S/.test(line[cursor])) {
        hasCode = true;
      }
      cursor += 1;
    }
    if (hasCode) {
      count += 1;
      canStartDoc = line.trimEnd().endsWith(":");
    } else if (!triple && line.trim() && !line.trimStart().startsWith("#")) {
      canStartDoc = false;
    }
  }
  return count;
}

export function countEffectiveLines(source, language) {
  const lines = sourceLines(source);
  if (language === "cmd") return countCommandLines(lines);
  if (language === "html") return countHtmlLines(lines);
  if (language === "powershell") return countPowerShellLines(lines);
  if (language === "python") return countPythonLines(lines);
  if (language === "rust" || language === "c-like" || language === "css") {
    return countCLikeLines(lines, language);
  }
  throw new Error(`Unsupported language: ${language}`);
}
