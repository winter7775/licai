import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { handleApiRequest } from "./apiHandlers";

const DEFAULT_PORT = 4173;
const DIST_DIR = path.resolve(process.cwd(), "dist");

export function shouldServeIndexHtml(pathname: string): boolean {
  if (pathname.startsWith("/api/")) return false;
  return path.extname(pathname) === "";
}

export function contentTypeForPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".js" || ext === ".mjs") return "text/javascript; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  return "application/octet-stream";
}

function safeStaticPath(pathname: string): string | null {
  const decoded = decodeURIComponent(pathname);
  const relativePath = decoded === "/" || shouldServeIndexHtml(decoded) ? "index.html" : decoded.replace(/^\/+/, "");
  const resolved = path.resolve(DIST_DIR, relativePath);
  return resolved.startsWith(DIST_DIR) ? resolved : null;
}

async function serveStatic(requestUrl: URL, response: ServerResponse) {
  const filePath = safeStaticPath(requestUrl.pathname);
  if (!filePath || !existsSync(filePath)) {
    response.statusCode = 404;
    response.setHeader("Content-Type", "text/plain; charset=utf-8");
    response.end("Not found");
    return;
  }

  const body = await readFile(filePath);
  response.statusCode = 200;
  response.setHeader("Content-Type", contentTypeForPath(filePath));
  response.setHeader("Cache-Control", path.basename(filePath) === "index.html" ? "no-cache" : "public, max-age=31536000, immutable");
  response.end(body);
}

export function createAppServer() {
  return createServer(async (request: IncomingMessage, response: ServerResponse) => {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    try {
      if (await handleApiRequest(request, response, requestUrl)) return;
      await serveStatic(requestUrl, response);
    } catch (error) {
      response.statusCode = 500;
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      response.end(JSON.stringify({ error: "APP_SERVER_ERROR", message: error instanceof Error ? error.message : String(error) }));
    }
  });
}

function isMainModule(): boolean {
  return process.argv[1] ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;
}

if (isMainModule()) {
  const port = Number(process.env.PORT ?? DEFAULT_PORT) || DEFAULT_PORT;
  const host = process.env.HOST ?? "0.0.0.0";
  createAppServer().listen(port, host, () => {
    console.log(`Mingyuan trading system listening on http://${host}:${port}`);
  });
}
