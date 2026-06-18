#!/usr/bin/env node

import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateNotionPdf, listPages, prepareInput, walkHtmlFiles } from "./notion-html-to-pdf.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "web");
const workspaceRoot = path.resolve(__dirname, "../..");
const outputRoot = path.join(workspaceRoot, "salida-notion-pdf", "web");
const uploadRoot = path.join(tmpdir(), "notion-pdf-web");
const sessions = new Map();

function jsonResponse(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

function textResponse(res, status, body, contentType = "text/plain; charset=utf-8") {
  res.writeHead(status, { "content-type": contentType });
  res.end(body);
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function safeRelativePath(filename) {
  const normalized = filename.replace(/\\/g, "/").replace(/^\/+/, "");
  const parts = normalized.split("/").filter((part) => part && part !== "." && part !== "..");
  return parts.join("/") || "archivo";
}

function safeJoin(baseDir, relativePath) {
  const resolved = path.resolve(baseDir, relativePath);
  if (!resolved.startsWith(path.resolve(baseDir))) {
    throw new Error("Ruta de archivo no permitida.");
  }
  return resolved;
}

function createSessionFromInput(inputPath, sourceDir = null) {
  const scanRoot = prepareInput(inputPath);
  const htmlFiles = walkHtmlFiles(scanRoot);
  const pages = listPages(scanRoot, htmlFiles);
  if (pages.length === 0) throw new Error("No se encontraron páginas HTML en la ruta indicada.");

  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  sessions.set(id, { id, inputPath: scanRoot, scanRoot, sourceDir, pages });
  return { id, pages };
}

function parseMultipart(buffer, contentType) {
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!boundaryMatch) throw new Error("No se encontró boundary multipart.");

  const boundary = Buffer.from(`--${boundaryMatch[1] || boundaryMatch[2]}`);
  const parts = [];
  let cursor = buffer.indexOf(boundary);

  while (cursor !== -1) {
    cursor += boundary.length;
    if (buffer[cursor] === 45 && buffer[cursor + 1] === 45) break;
    if (buffer[cursor] === 13 && buffer[cursor + 1] === 10) cursor += 2;

    const headerEnd = buffer.indexOf(Buffer.from("\r\n\r\n"), cursor);
    if (headerEnd === -1) break;

    const headerText = buffer.slice(cursor, headerEnd).toString("utf8");
    const nextBoundary = buffer.indexOf(boundary, headerEnd + 4);
    if (nextBoundary === -1) break;

    let content = buffer.slice(headerEnd + 4, nextBoundary);
    if (content.at(-2) === 13 && content.at(-1) === 10) {
      content = content.slice(0, -2);
    }

    const disposition = headerText.match(/content-disposition:\s*form-data;([^\n]+)/i)?.[1] || "";
    const name = disposition.match(/name="([^"]+)"/i)?.[1] || "";
    const filename = disposition.match(/filename="([^"]*)"/i)?.[1] || "";
    const contentTypePart = headerText.match(/content-type:\s*([^\n]+)/i)?.[1]?.trim() || "";
    parts.push({ name, filename, contentType: contentTypePart, content });
    cursor = nextBoundary;
  }

  return parts;
}

function inferInputPath(sourceDir, savedFiles) {
  const zip = savedFiles.find((file) => file.toLowerCase().endsWith(".zip"));
  if (zip && savedFiles.length === 1) return safeJoin(sourceDir, zip);
  return sourceDir;
}

function createUploadSession(sourceDir, savedFiles) {
  const inputPath = inferInputPath(sourceDir, savedFiles);
  return createSessionFromInput(inputPath, sourceDir);
}

async function handleUpload(req, res) {
  const contentType = req.headers["content-type"] || "";
  const body = await readRequestBody(req);
  const parts = parseMultipart(body, contentType);
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const sourceDir = path.join(uploadRoot, id, "source");
  mkdirSync(sourceDir, { recursive: true });

  const savedFiles = [];
  for (const part of parts) {
    if (part.name !== "files" || !part.filename) continue;
    const relative = safeRelativePath(part.filename);
    const destination = safeJoin(sourceDir, relative);
    mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(destination, part.content);
    savedFiles.push(relative);
  }

  if (savedFiles.length === 0) {
    throw new Error("No se recibió ningún archivo.");
  }

  const session = createUploadSession(sourceDir, savedFiles);
  jsonResponse(res, 200, {
    uploadId: session.id,
    pages: session.pages,
    fileCount: savedFiles.length,
  });
}

async function handleGenerate(req, res) {
  const body = JSON.parse((await readRequestBody(req)).toString("utf8") || "{}");
  const session = sessions.get(body.uploadId);
  if (!session) throw new Error("La subida ya no está disponible. Vuelve a cargar el export.");

  const selected = Array.isArray(body.pages) ? body.pages : [];
  if (selected.length === 0) throw new Error("Selecciona al menos una página.");

  const out = path.join(outputRoot, session.id);
  mkdirSync(out, { recursive: true });

  const result = await generateNotionPdf({
    input: session.scanRoot,
    out,
    includeRelativePaths: selected,
    pagePdfs: true,
    book: true,
    title: body.title || "PR2026 - exportacion seleccionada",
  });

  const downloads = {
    compiled: `/download/${session.id}/PR2026_compilado.pdf`,
    individual: result.individualPdfs.map((pdfPath) => {
      const relative = path.relative(out, pdfPath).split(path.sep).map(encodeURIComponent).join("/");
      return `/download/${session.id}/${relative}`;
    }),
  };

  jsonResponse(res, 200, {
    pages: result.pages,
    downloads,
  });
}

function serveStatic(req, res, pathname) {
  const filePath = pathname === "/" ? path.join(publicDir, "index.html") : safeJoin(publicDir, pathname.slice(1));
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    textResponse(res, 404, "No encontrado");
    return;
  }

  const ext = path.extname(filePath);
  const contentType = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
  }[ext] || "application/octet-stream";

  textResponse(res, 200, readFileSync(filePath), contentType);
}

function serveDownload(req, res, pathname) {
  const [, , id, ...relativeParts] = pathname.split("/");
  if (!sessions.has(id)) {
    textResponse(res, 404, "Export no encontrado");
    return;
  }

  const filePath = safeJoin(path.join(outputRoot, id), relativeParts.map(decodeURIComponent).join("/"));
  if (!existsSync(filePath)) {
    textResponse(res, 404, "Archivo no encontrado");
    return;
  }

  res.writeHead(200, {
    "content-type": "application/pdf",
    "content-disposition": `attachment; filename="${path.basename(filePath).replace(/"/g, "")}"`,
    "cache-control": "no-store",
  });
  res.end(readFileSync(filePath));
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if (req.method === "GET" && url.pathname === "/api/health") return jsonResponse(res, 200, { ok: true });
    if (req.method === "GET" && url.pathname === "/api/config") return jsonResponse(res, 200, {});
    if (req.method === "POST" && url.pathname === "/api/upload") return await handleUpload(req, res);
    if (req.method === "POST" && url.pathname === "/api/generate") return await handleGenerate(req, res);
    if (req.method === "GET" && url.pathname.startsWith("/download/")) return serveDownload(req, res, url.pathname);
    if (req.method === "GET") return serveStatic(req, res, url.pathname);
    textResponse(res, 405, "Método no permitido");
  } catch (error) {
    jsonResponse(res, 500, { error: error.message });
  }
});

const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "127.0.0.1";

server.listen(port, host, () => {
  console.log(`Notion PDF Export disponible en http://${host}:${port}`);
});
