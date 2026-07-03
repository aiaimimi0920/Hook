import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import http from "node:http";

const DEFAULT_PORT = 1420;
const DEFAULT_ROOT = ".output/public";

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
};

function parseArgs(argv) {
  const args = {
    host: process.env.HOST,
    port: Number(process.env.PORT || DEFAULT_PORT),
    root: process.env.STATIC_ROOT || DEFAULT_ROOT,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];
    const next = argv[i + 1];

    if ((current === "--port" || current === "-p") && next) {
      args.port = Number(next);
      i += 1;
    } else if ((current === "--host" || current === "-h") && next) {
      args.host = next;
      i += 1;
    } else if ((current === "--root" || current === "-r") && next) {
      args.root = next;
      i += 1;
    }
  }

  return args;
}

function safeResolve(rootDir, requestPath) {
  const normalizedRequest = requestPath.replace(/^\/+/, "");
  const resolved = resolve(rootDir, normalizedRequest);
  const normalizedRoot = normalize(rootDir);

  if (!resolved.startsWith(normalizedRoot)) {
    return null;
  }

  return resolved;
}

function sendFile(filePath, res) {
  const ext = extname(filePath).toLowerCase();
  const mimeType = MIME_TYPES[ext] || "application/octet-stream";

  res.writeHead(200, {
    "Content-Type": mimeType,
    "Cache-Control": "no-store",
  });

  createReadStream(filePath).pipe(res);
}

const { host, port, root } = parseArgs(process.argv.slice(2));
const rootDir = resolve(process.cwd(), root);
const indexFile = join(rootDir, "index.html");

if (!existsSync(indexFile)) {
  console.error(`[serve-static] Missing entry file: ${indexFile}`);
  process.exit(1);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const pathname = decodeURIComponent(url.pathname);
  const directPath = safeResolve(rootDir, pathname);
  const fallbackToIndex = !extname(pathname);

  if (directPath && existsSync(directPath) && statSync(directPath).isFile()) {
    sendFile(directPath, res);
    return;
  }

  if (fallbackToIndex) {
    sendFile(indexFile, res);
    return;
  }

  res.writeHead(404, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end("Not Found");
});

server.listen(port, host, () => {
  const announceHost = host || "localhost";
  console.log(`[serve-static] Serving ${rootDir} on http://${announceHost}:${port}`);
});

server.on("error", (error) => {
  console.error("[serve-static] Server error:", error);
  process.exit(1);
});
