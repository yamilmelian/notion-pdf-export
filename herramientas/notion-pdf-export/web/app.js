const state = {
  uploadId: null,
  pages: [],
  selected: new Set(),
};

const folderInput = document.querySelector("#folderInput");
const fileInput = document.querySelector("#fileInput");
const dropZone = document.querySelector("#dropZone");
const pagesList = document.querySelector("#pagesList");
const pageSummary = document.querySelector("#pageSummary");
const selectAll = document.querySelector("#selectAll");
const selectNone = document.querySelector("#selectNone");
const generateButton = document.querySelector("#generateButton");
const statusBox = document.querySelector("#status");
const resultBox = document.querySelector("#result");
const pdfTitle = document.querySelector("#pdfTitle");
const pathInput = document.querySelector("#pathInput");
const scanPathButton = document.querySelector("#scanPathButton");

function setStatus(message, tone = "") {
  statusBox.className = `status ${tone ? `is-${tone}` : ""}`;
  statusBox.textContent = message;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function renderPages() {
  if (state.pages.length === 0) {
    pagesList.className = "pages-list empty-state";
    pagesList.textContent = "Sube un export para ver la página principal y sus subpáginas.";
    pageSummary.textContent = "Todavía no hay páginas cargadas.";
    generateButton.disabled = true;
    return;
  }

  pagesList.className = "pages-list";
  pagesList.innerHTML = "";
  pageSummary.textContent = `${state.pages.length} páginas detectadas, ${state.selected.size} seleccionadas.`;
  generateButton.disabled = state.selected.size === 0;

  for (const page of state.pages) {
    const label = document.createElement("label");
    label.className = "page-item";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = state.selected.has(page.relativePath);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) state.selected.add(page.relativePath);
      else state.selected.delete(page.relativePath);
      resultBox.hidden = true;
      renderPages();
    });

    const content = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = page.title || page.relativePath;

    const relativePath = document.createElement("span");
    relativePath.textContent = page.relativePath;

    const meta = document.createElement("div");
    meta.className = "page-meta";
    const index = document.createElement("span");
    index.className = "pill";
    index.textContent = `Página ${page.index}`;
    const size = document.createElement("span");
    size.className = "pill";
    size.textContent = formatBytes(page.bytes);
    const links = document.createElement("span");
    links.className = "pill";
    links.textContent = `${page.linkCount} enlaces HTML`;

    meta.append(index, size, links);
    content.append(title, relativePath, meta);
    label.append(checkbox, content);
    pagesList.append(label);
  }
}

async function uploadFiles(files) {
  const fileList = [...files].filter(Boolean);
  if (fileList.length === 0) return;

  setStatus(`Subiendo ${fileList.length} archivo(s)...`, "busy");
  resultBox.hidden = true;

  const formData = new FormData();
  for (const file of fileList) {
    formData.append("files", file, file.webkitRelativePath || file.name);
  }

  const response = await fetch("/api/upload", {
    method: "POST",
    body: formData,
  });
  const payload = await response.json();
  if (!response.ok || payload.error) {
    throw new Error(payload.error || "No se pudo procesar la subida.");
  }

  state.uploadId = payload.uploadId;
  state.pages = payload.pages;
  state.selected = new Set(payload.pages.map((page) => page.relativePath));
  renderPages();
  if (payload.pages.length === 1 && payload.pages[0].linkCount > 0) {
    setStatus("Solo se ha cargado el HTML principal. Para seleccionar subpáginas, sube la carpeta completa o usa la ruta local del export.", "error");
    return;
  }
  setStatus(`Subida lista: ${payload.fileCount} archivo(s), ${payload.pages.length} página(s) HTML detectadas.`, "ok");
}

async function scanLocalPath() {
  const localPath = pathInput.value.trim();
  if (!localPath) return;

  setStatus("Leyendo la ruta local del export...", "busy");
  resultBox.hidden = true;

  const response = await fetch("/api/scan-path", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: localPath }),
  });
  const payload = await response.json();
  if (!response.ok || payload.error) {
    throw new Error(payload.error || "No se pudo leer la ruta indicada.");
  }

  state.uploadId = payload.uploadId;
  state.pages = payload.pages;
  state.selected = new Set(payload.pages.map((page) => page.relativePath));
  renderPages();
  setStatus(`Ruta cargada: ${payload.pages.length} página(s) HTML detectadas. Marca solo la plantilla y las subpáginas que quieras.`, "ok");
}

async function generatePdf() {
  if (!state.uploadId || state.selected.size === 0) return;

  setStatus("Generando PDFs. Esto puede tardar si hay muchas páginas o imágenes.", "busy");
  resultBox.hidden = true;
  generateButton.disabled = true;

  const response = await fetch("/api/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      uploadId: state.uploadId,
      pages: [...state.selected],
      title: pdfTitle.value.trim() || "PR2026 - exportación seleccionada",
    }),
  });

  const payload = await response.json();
  if (!response.ok || payload.error) {
    throw new Error(payload.error || "No se pudo generar el PDF.");
  }

  setStatus(`PDF generado con ${payload.pages.length} página(s).`, "ok");
  generateButton.disabled = false;
  renderPages();
  renderResult(payload);
}

function renderResult(payload) {
  resultBox.hidden = false;
  resultBox.innerHTML = "";

  const title = document.createElement("h3");
  title.textContent = "Descargas";

  const compiled = document.createElement("a");
  compiled.href = payload.downloads.compiled;
  compiled.textContent = "Descargar PDF compilado";

  const output = document.createElement("p");
  output.textContent = `Salida local: ${payload.outputPath}`;

  const list = document.createElement("ul");
  payload.downloads.individual.forEach((url, index) => {
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.href = url;
    link.textContent = `PDF individual ${index + 1}`;
    item.append(link);
    list.append(item);
  });

  resultBox.append(title, compiled, output, list);
}

folderInput.addEventListener("change", async () => {
  try {
    await uploadFiles(folderInput.files);
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    folderInput.value = "";
  }
});

fileInput.addEventListener("change", async () => {
  try {
    await uploadFiles(fileInput.files);
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    fileInput.value = "";
  }
});

dropZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  dropZone.classList.add("drag-over");
});

dropZone.addEventListener("dragleave", () => {
  dropZone.classList.remove("drag-over");
});

dropZone.addEventListener("drop", async (event) => {
  event.preventDefault();
  dropZone.classList.remove("drag-over");
  try {
    await uploadFiles(event.dataTransfer.files);
  } catch (error) {
    setStatus(error.message, "error");
  }
});

selectAll.addEventListener("click", () => {
  state.selected = new Set(state.pages.map((page) => page.relativePath));
  resultBox.hidden = true;
  renderPages();
});

selectNone.addEventListener("click", () => {
  state.selected = new Set();
  resultBox.hidden = true;
  renderPages();
});

scanPathButton.addEventListener("click", async () => {
  try {
    await scanLocalPath();
  } catch (error) {
    setStatus(error.message, "error");
  }
});

pathInput.addEventListener("keydown", async (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  try {
    await scanLocalPath();
  } catch (error) {
    setStatus(error.message, "error");
  }
});

generateButton.addEventListener("click", async () => {
  try {
    await generatePdf();
  } catch (error) {
    generateButton.disabled = state.selected.size === 0;
    setStatus(error.message, "error");
  }
});

renderPages();
