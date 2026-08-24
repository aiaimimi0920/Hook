import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";

const publicAssets = new Map([
    ["/javascript-surface-host.html", ["javascript-surface-host.html", "text/html; charset=utf-8"]],
    ["/javascript-surface-bootstrap.js", ["javascript-surface-bootstrap.js", "text/javascript; charset=utf-8"]],
]);

export const createSurfaceServer = ({ root, tauriCsp }) => http.createServer(async (request, response) => {
    try {
        const requestPath = new URL(request.url || "/", "http://127.0.0.1").pathname;
        response.setHeader("Content-Security-Policy", tauriCsp);
        if (requestPath === "/__javascript-surface-smoke") {
            response.statusCode = 200;
            response.setHeader("Content-Type", "text/html; charset=utf-8");
            response.end("<!doctype html><html><body></body></html>");
            return;
        }
        const asset = publicAssets.get(requestPath);
        if (!asset) {
            response.statusCode = 404;
            response.end("Not found");
            return;
        }
        const [assetName, contentType] = asset;
        const body = await fs.readFile(path.join(root, "public", assetName));
        response.statusCode = 200;
        response.setHeader("Content-Type", contentType);
        response.setHeader("Content-Length", String(body.byteLength));
        response.end(body);
    } catch (error) {
        response.statusCode = 500;
        response.end(String(error));
    }
});

export const listenSurfaceServer = async (server) => {
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") {
        throw new Error("JavaScript Surface test server did not bind TCP");
    }
    const baseUrl = `http://127.0.0.1:${address.port}`;
    return {
        harnessUrl: `${baseUrl}/__javascript-surface-smoke`,
        surfaceHostUrl: `${baseUrl}/javascript-surface-host.html`,
        bootstrapUrl: `${baseUrl}/javascript-surface-bootstrap.js`,
    };
};

export const verifySurfaceAssets = async ({ surfaceHostUrl, bootstrapUrl }) => {
    for (const url of [surfaceHostUrl, bootstrapUrl]) {
        const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
        if (!response.ok) {
            throw new Error(`JavaScript Surface asset returned ${response.status}: ${url}`);
        }
        await response.arrayBuffer();
    }
};

export const closeSurfaceServer = async (server) => {
    if (!server.listening) return;
    await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections?.();
    });
};
