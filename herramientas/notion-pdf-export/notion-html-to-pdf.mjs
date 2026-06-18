#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DEFAULT_CHROME_PATHS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
];

const A4_PRINT_CSS = `
  @page {
    size: A4;
    margin: 12mm 10mm;
  }
  html {
    -webkit-print-color-adjust: exact;
  }
  * {
    -webkit-print-color-adjust: exact;
    box-sizing: border-box;
  }
  img,
  video,
  iframe {
    max-width: 100%;
  }
  body {
    margin: 0 !important;
    max-width: none !important;
    padding: 0 !important;
  }
  article.page {
    margin-left: auto !important;
    margin-right: auto !important;
    max-width: 190mm !important;
    width: 100% !important;
  }
  .page-body,
  .collection-content-wrapper,
  .collection-content,
  .simple-table {
    max-width: 100% !important;
  }
  .collection-content-wrapper {
    overflow-x: visible !important;
  }
  table {
    max-width: 100% !important;
    table-layout: fixed !important;
    width: 100% !important;
  }
  th,
  td {
    overflow-wrap: anywhere !important;
    word-break: normal !important;
  }
  .column-list {
    align-items: stretch !important;
    display: grid !important;
    gap: 8mm !important;
    grid-template-columns: repeat(auto-fit, minmax(72mm, 1fr)) !important;
    width: 100% !important;
  }
  .column {
    min-width: 0 !important;
    width: auto !important;
  }
  figure,
  .callout,
  blockquote,
  table,
  .collection-content-wrapper,
  .simple-table,
  .source,
  li {
    break-inside: avoid;
    page-break-inside: avoid;
  }
  h1,
  h2,
  h3 {
    break-after: avoid;
    orphans: 3;
    page-break-after: avoid;
    widows: 3;
  }
  p,
  li {
    orphans: 3;
    widows: 3;
  }
`;

function usage() {
  console.log(`Uso:
  node herramientas/notion-pdf-export/notion-html-to-pdf.mjs <export-notion.zip|carpeta-exportada> [--out carpeta-salida]

Ejemplo:
  node herramientas/notion-pdf-export/notion-html-to-pdf.mjs ~/Downloads/PR2026.zip --out ~/Desktop/PR2026_PDF

Qué genera:
  - PDFs individuales por cada página HTML exportada desde Notion.
  - PR2026_compilado.pdf con todas las páginas y subpáginas en un único documento.

Opciones:
  --include-file seleccion.json   Genera solo las páginas relativas indicadas en un JSON array.
  --list-json                     Lista páginas detectadas en JSON y no genera PDFs.
`);
}

function parseArgs(argv) {
  const args = { input: null, out: null, pagePdfs: true, book: true, includeFile: null, listJson: false };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    }
    if (arg === "--out") {
      args.out = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--no-page-pdfs") {
      args.pagePdfs = false;
      continue;
    }
    if (arg === "--no-book") {
      args.book = false;
      continue;
    }
    if (arg === "--include-file") {
      args.includeFile = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--list-json") {
      args.listJson = true;
      continue;
    }
    if (!args.input) {
      args.input = arg;
      continue;
    }
    throw new Error(`Argumento no reconocido: ${arg}`);
  }

  if (!args.input) {
    usage();
    process.exit(1);
  }

  args.input = path.resolve(expandHome(args.input));
  args.out = path.resolve(expandHome(args.out || path.join(process.cwd(), "salida-notion-pdf")));
  return args;
}

function expandHome(value) {
  if (!value) return value;
  if (value === "~") return process.env.HOME;
  if (value.startsWith("~/")) return path.join(process.env.HOME, value.slice(2));
  return value;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", stdio: "pipe", ...options });
  if (result.status !== 0) {
    const stderr = result.stderr?.trim();
    const stdout = result.stdout?.trim();
    throw new Error(`${command} ${args.join(" ")}\n${stderr || stdout || "Comando fallido sin salida."}`);
  }
  return result;
}

export function findChrome() {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH;
  }
  for (const candidate of DEFAULT_CHROME_PATHS) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error("No se encontró Chrome, Chromium ni Edge. Instala Chrome o define CHROME_PATH.");
}

export function prepareInput(inputPath) {
  if (!existsSync(inputPath)) {
    throw new Error(`No existe la ruta de entrada: ${inputPath}`);
  }

  const stats = statSync(inputPath);
  if (stats.isDirectory()) return inputPath;

  if (inputPath.toLowerCase().endsWith(".html")) {
    return path.dirname(inputPath);
  }

  if (!inputPath.toLowerCase().endsWith(".zip")) {
    throw new Error("La entrada debe ser una carpeta exportada desde Notion, un archivo .html o un archivo .zip.");
  }

  const extractDir = mkdtempSync(path.join(tmpdir(), "notion-export-"));
  const unzip = existsSync("/usr/bin/unzip") ? "/usr/bin/unzip" : null;

  if (unzip) {
    run(unzip, ["-q", inputPath, "-d", extractDir]);
  } else {
    run("/usr/bin/ditto", ["-x", "-k", inputPath, extractDir]);
  }

  return extractDir;
}

export function walkHtmlFiles(rootDir) {
  const files = [];

  function walk(dir) {
    for (const name of readdirSync(dir)) {
      if (name === "__MACOSX" || name === ".DS_Store") continue;
      const absolute = path.join(dir, name);
      const stats = statSync(absolute);
      if (stats.isDirectory()) {
        walk(absolute);
      } else if (name.toLowerCase().endsWith(".html") && !name.startsWith("_notion_pdf_")) {
        files.push(absolute);
      }
    }
  }

  walk(rootDir);
  return files.sort((a, b) => path.relative(rootDir, a).localeCompare(path.relative(rootDir, b), "es"));
}

function sanitizeFilename(value) {
  return value
    .replace(/\.html$/i, "")
    .replace(/[\\/]/g, "__")
    .replace(/[^\p{L}\p{N}._ -]+/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160) || "pagina";
}

function extractTagContent(html, tagName) {
  const match = html.match(new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i"));
  return match ? match[1].trim() : "";
}

function extractTitle(html, fallback) {
  const title = extractTagContent(html, "title")
    .replace(/\s+/g, " ")
    .replace(/&nbsp;/g, " ")
    .trim();
  if (title) return stripHtml(title);

  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1) return stripHtml(h1[1]).trim();

  return fallback;
}

function stripHtml(value) {
  return value
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function extractStyles(html) {
  const styles = [];
  for (const match of html.matchAll(/<style[^>]*>[\s\S]*?<\/style>/gi)) {
    styles.push(match[0]);
  }
  return styles;
}

function rewriteRelativeUrls(fragment, htmlFile) {
  const baseDir = path.dirname(htmlFile);

  function absolutize(rawUrl) {
    const value = rawUrl.trim();
    if (
      value.startsWith("#") ||
      value.startsWith("data:") ||
      value.startsWith("http://") ||
      value.startsWith("https://") ||
      value.startsWith("mailto:") ||
      value.startsWith("file:")
    ) {
      return rawUrl;
    }

    const withoutAnchor = value.split("#")[0];
    const anchor = value.includes("#") ? `#${value.split("#").slice(1).join("#")}` : "";
    const absolute = path.resolve(baseDir, decodeURIComponent(withoutAnchor));
    return `${pathToFileURL(absolute).href}${anchor}`;
  }

  return sanitizeLocalAnchors(fragment)
    .replace(/\s(src)=["']([^"']+)["']/gi, (_match, attr, url) => ` ${attr}="${absolutize(url)}"`)
    .replace(/url\((["']?)(?!data:|http:\/\/|https:\/\/|file:)([^"')]+)\1\)/gi, (_match, quote, url) => {
      return `url("${absolutize(url)}")`;
    });
}

function sanitizeLocalAnchors(html) {
  return html.replace(/<a\b([^>]*?)\s+href=["']([^"']+)["']([^>]*)>/gi, (match, before, href, after) => {
    const value = href.trim().toLowerCase();
    const keep =
      value.startsWith("#") ||
      value.startsWith("http://") ||
      value.startsWith("https://") ||
      value.startsWith("mailto:");

    if (keep) return match;
    return `<a${before} href="#"${after}>`;
  });
}

export function getPageInfo(rootDir, file, index) {
  const raw = readFileSync(file, "utf8");
  const relativePath = path.relative(rootDir, file);
  const title = extractTitle(raw, path.basename(file, ".html"));
  const stats = statSync(file);
  const linkCount = [...raw.matchAll(/<a\s+[^>]*href=["']([^"']+\.html(?:#[^"']*)?)["']/gi)].length;
  return {
    index: index + 1,
    relativePath,
    title,
    bytes: stats.size,
    linkCount,
  };
}

export function listPages(rootDir, htmlFiles = walkHtmlFiles(rootDir)) {
  return htmlFiles.map((file, index) => getPageInfo(rootDir, file, index));
}

export function buildCompiledHtml(rootDir, htmlFiles, outputHtml, options = {}) {
  const seenStyles = new Set();
  const styles = [];
  const sections = [];

  htmlFiles.forEach((file, index) => {
    const raw = readFileSync(file, "utf8");
    for (const style of extractStyles(raw)) {
      if (!seenStyles.has(style)) {
        seenStyles.add(style);
        styles.push(style);
      }
    }

    const body = extractTagContent(raw, "body") || raw;
    const cleanBody = rewriteRelativeUrls(body, file)
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
    const sectionId = `pagina-${index + 1}`;

    sections.push(`
      <section id="${sectionId}" class="notion-export-section">
        ${cleanBody}
      </section>
    `);
  });

  const documentTitle = options.title || "PR2026 - exportacion completa";
  const compiled = `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>${documentTitle}</title>
  ${styles.join("\n")}
  <style>
    ${A4_PRINT_CSS}
    .notion-export-section {
      break-before: page;
      break-inside: auto;
    }
    .notion-export-section:first-of-type {
      break-before: auto;
    }
    @media print {
      .notion-export-section {
        page-break-before: always;
      }
      .notion-export-section:first-of-type {
        page-break-before: auto;
      }
    }
  </style>
</head>
<body>
  ${sections.join("\n")}
</body>
</html>`;

  writeFileSync(outputHtml, compiled, "utf8");
}

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function pdfReady(pdfFile, lastSize) {
  if (!existsSync(pdfFile)) return { ready: false, size: 0, stable: false };
  const size = statSync(pdfFile).size;
  return { ready: size > 0, size, stable: size > 0 && size === lastSize };
}

function createPrintableHtml(htmlFile) {
  const raw = readFileSync(htmlFile, "utf8");
  const printStyle = `<style id="notion-pdf-a4-print">\n${A4_PRINT_CSS}\n</style>`;
  const sanitized = sanitizeLocalAnchors(raw);
  const html = sanitized.includes("</head>")
    ? sanitized.replace(/<\/head>/i, `${printStyle}\n</head>`)
    : `${printStyle}\n${sanitized}`;
  const tmpName = `_notion_pdf_print_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.html`;
  const tmpPath = path.join(path.dirname(htmlFile), tmpName);
  writeFileSync(tmpPath, html, "utf8");
  return tmpPath;
}

export function printPdf(chromePath, htmlFile, pdfFile) {
  const printableHtml = createPrintableHtml(htmlFile);
  const htmlUrl = pathToFileURL(printableHtml).href;
  const chromeProfile = mkdtempSync(path.join(tmpdir(), "notion-pdf-chrome-"));
  const chromeArgs = [
    "--headless=new",
    "--disable-gpu",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-dev-shm-usage",
    "--disable-extensions",
    "--disable-sync",
    "--metrics-recording-only",
    "--no-sandbox",
    "--noerrdialogs",
    "--no-first-run",
    "--no-default-browser-check",
    "--no-pdf-header-footer",
    "--print-to-pdf-no-header",
    "--allow-file-access-from-files",
    `--user-data-dir=${chromeProfile}`,
    `--print-to-pdf=${pdfFile}`,
    htmlUrl,
  ];

  return new Promise((resolve, reject) => {
    const timeoutMs = Number(process.env.NOTION_PDF_TIMEOUT_MS || 30000);
    const child = spawn(chromePath, chromeArgs, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let lastSize = 0;
    let stableChecks = 0;

    function finish(error) {
      if (settled) return;
      settled = true;
      clearInterval(interval);
      clearTimeout(timeout);
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGTERM");
      }
      try {
        unlinkSync(printableHtml);
      } catch {
        // Temporary print file cleanup is best-effort.
      }
      if (error) reject(error);
      else resolve();
    }

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      finish(error);
    });
    child.on("exit", (code) => {
      if (settled) return;
      if (code === 0 || pdfReady(pdfFile, lastSize).ready) {
        finish();
      } else {
        finish(new Error(`${chromePath} ${chromeArgs.join(" ")}\n${stderr.trim() || stdout.trim() || "Chrome no pudo generar el PDF."}`));
      }
    });

    const interval = setInterval(() => {
      const status = pdfReady(pdfFile, lastSize);
      if (!status.ready) return;

      if (status.stable) stableChecks += 1;
      else stableChecks = 0;

      lastSize = status.size;

      if (stableChecks >= 2 || stdout.includes("written to file")) {
        finish();
      }
    }, 500);

    const timeout = setTimeout(() => {
      if (pdfReady(pdfFile, lastSize).ready) {
        finish();
      } else {
        finish(new Error(`Tiempo agotado generando PDF: ${pdfFile}`));
      }
    }, timeoutMs);
  });
}

function selectHtmlFiles(rootDir, htmlFiles, includeRelativePaths) {
  if (!includeRelativePaths?.length) return htmlFiles;
  const allowed = new Set(includeRelativePaths);
  return htmlFiles.filter((file) => allowed.has(path.relative(rootDir, file)));
}

export async function generateNotionPdf({ input, out, pagePdfs = true, book = true, includeRelativePaths = null, title = null }) {
  const chromePath = findChrome();
  const rootDir = prepareInput(input);
  const allHtmlFiles = walkHtmlFiles(rootDir);
  const htmlFiles = selectHtmlFiles(rootDir, allHtmlFiles, includeRelativePaths);

  if (htmlFiles.length === 0) {
    throw new Error("No se encontraron archivos HTML seleccionados en la exportacion de Notion.");
  }

  mkdirSync(out, { recursive: true });

  const individualDir = path.join(out, "paginas");
  const individualPdfs = [];
  if (pagePdfs) {
    mkdirSync(individualDir, { recursive: true });
    for (const [index, file] of htmlFiles.entries()) {
      const relative = path.relative(rootDir, file);
      const pdfName = `${String(index + 1).padStart(2, "0")} - ${sanitizeFilename(relative)}.pdf`;
      const pdfPath = path.join(individualDir, pdfName);
      await printPdf(chromePath, file, pdfPath);
      individualPdfs.push(pdfPath);
    }
  }

  let compiledPdf = null;
  let compiledHtml = null;
  if (book) {
    compiledHtml = path.join(out, "_notion_pdf_compilado.html");
    compiledPdf = path.join(out, "PR2026_compilado.pdf");
    buildCompiledHtml(rootDir, htmlFiles, compiledHtml, { title });
    await printPdf(chromePath, compiledHtml, compiledPdf);
  }

  return {
    input,
    out,
    rootDir,
    pages: listPages(rootDir, htmlFiles),
    compiledHtml,
    compiledPdf,
    individualPdfs,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rootDir = prepareInput(args.input);
  const allHtmlFiles = walkHtmlFiles(rootDir);
  let includeRelativePaths = null;

  if (args.includeFile) {
    includeRelativePaths = JSON.parse(readFileSync(path.resolve(expandHome(args.includeFile)), "utf8"));
  }

  const htmlFiles = selectHtmlFiles(rootDir, allHtmlFiles, includeRelativePaths);

  if (args.listJson) {
    console.log(JSON.stringify({ rootDir, pages: listPages(rootDir, htmlFiles) }, null, 2));
    return;
  }

  const result = await generateNotionPdf({
    input: args.input,
    out: args.out,
    pagePdfs: args.pagePdfs,
    book: args.book,
    includeRelativePaths,
  });

  console.log(`Exportacion completada.
Entrada: ${result.input}
Paginas HTML encontradas: ${result.pages.length}
Salida: ${result.out}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(fileURLToPath(import.meta.url)).href && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}
