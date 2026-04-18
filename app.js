/* ===========================================
   OCRLearning — app.js
   Split-view editor · Mistral OCR · PDF.js
   =========================================== */
'use strict';

// ─── PDF.js worker ───────────────────────────────────────────────────────────
if (typeof pdfjsLib !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

// ─── Constants ───────────────────────────────────────────────────────────────
const KEY_STORAGE  = 'ocrl_mistral_api_key';
const OCR_ENDPOINT = 'https://api.mistral.ai/v1/ocr';
const OCR_MODEL    = 'mistral-ocr-latest';
const MAX_BYTES    = 50 * 1024 * 1024; // 50 MB

// ─── State ───────────────────────────────────────────────────────────────────
let pages       = [];   // [{ markdown: string, editedHtml: string|null }]
let currentPage = 0;
let totalPages  = 0;
let pdfDoc      = null;
let fileIsImage = false;
let imgDataURL  = '';
let fileName    = '';
let savedRange  = null; // saved selection for toolbar actions

// ─── DOM helpers ─────────────────────────────────────────────────────────────
const $  = id => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);

// ─── DOM refs ────────────────────────────────────────────────────────────────
const apiKeyModal     = $('apiKeyModal');
const apiKeyInput     = $('apiKeyInput');
const saveApiKeyBtn   = $('saveApiKey');
const editApiKeyBtn   = $('editApiKey');
const toggleKeyBtn    = $('toggleKeyVisibility');

const tocModal        = $('tocModal');
const tocContent      = $('tocContent');
const tocBtn          = $('tocBtn');
const closeTocBtn     = $('closeTocBtn');
const closeTocFooter  = $('closeTocFooterBtn');
const insertTocBtn    = $('insertTocBtn');

const uploadSection   = $('uploadSection');
const dropZone        = $('dropZone');
const fileInput       = $('fileInput');
const browseBtn       = $('browseBtn');
const uploadLoading   = $('uploadLoading');

const workspace       = $('workspaceSection');
const newAnalysisBtn  = $('newAnalysisBtn');

const sourcePanel     = $('sourcePanel');
const pdfCanvas       = $('pdfCanvas');
const imgPreview      = $('imgPreview');
const pdfLoading      = $('pdfLoading');
const editor          = $('editor');

const prevBtn         = $('prevBtn');
const nextBtn         = $('nextBtn');
const currentPageEl   = $('currentPageEl');
const totalPagesEl    = $('totalPagesEl');
const exportDocxBtn   = $('exportDocxBtn');
const toastEl         = $('toast');

// ─── API KEY ─────────────────────────────────────────────────────────────────
const getApiKey = () => localStorage.getItem(KEY_STORAGE) || '';

function showApiModal() {
  apiKeyModal.classList.remove('hidden');
  setTimeout(() => apiKeyInput.focus(), 80);
}
function hideApiModal() { apiKeyModal.classList.add('hidden'); }

saveApiKeyBtn.addEventListener('click', () => {
  const val = apiKeyInput.value.trim();
  if (!val) { showToast('Please enter an API key.', 'err'); return; }
  localStorage.setItem(KEY_STORAGE, val);
  hideApiModal();
  showToast('API key saved!', 'ok');
});

editApiKeyBtn.addEventListener('click', () => {
  apiKeyInput.value = getApiKey();
  showApiModal();
});

toggleKeyBtn.addEventListener('click', () => {
  apiKeyInput.type = apiKeyInput.type === 'password' ? 'text' : 'password';
});

apiKeyModal.addEventListener('click', e => {
  if (e.target === apiKeyModal && getApiKey()) hideApiModal();
});

apiKeyInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') saveApiKeyBtn.click();
});

// ─── FILE UPLOAD ─────────────────────────────────────────────────────────────
browseBtn.addEventListener('click', e => { e.stopPropagation(); fileInput.click(); });
dropZone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => { if (fileInput.files[0]) handleFile(fileInput.files[0]); });

dropZone.addEventListener('dragenter', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragover',  e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', e => {
  if (!dropZone.contains(e.relatedTarget)) dropZone.classList.remove('drag-over');
});
dropZone.addEventListener('drop', e => {
  e.preventDefault(); dropZone.classList.remove('drag-over');
  if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
});

async function handleFile(file) {
  const apiKey = getApiKey();
  if (!apiKey) { showApiModal(); return; }
  if (file.size > MAX_BYTES) { showToast('File too large (max 50 MB).', 'err'); return; }

  fileName    = file.name;
  fileIsImage = file.type.startsWith('image/');

  dropZone.style.display = 'none';
  uploadLoading.style.display = 'block';

  try {
    const dataURI = await readFileAsDataURL(file);

    // Call Mistral OCR
    const result = await callMistralOCR(apiKey, dataURI, file.type);
    const rawPages = Array.isArray(result.pages) ? result.pages : [];
    pages = rawPages.map(p => ({
      markdown:   cleanPageNumbers(p.markdown || ''),
      editedHtml: null,
      header:     cleanPageNumbers(extractText(p.header)),
      footer:     cleanPageNumbers(extractText(p.footer))
    }));
    if (pages.length === 0) pages = [{ markdown: '', editedHtml: '<p>No content extracted.</p>', header: '', footer: '' }];

    removeRepeatedLines(pages); // universal running-header/footer removal

    totalPages  = pages.length;
    currentPage = 0;

    // Set up source viewer
    if (fileIsImage) {
      imgDataURL = dataURI;
      pdfCanvas.style.display = 'none';
      imgPreview.src   = dataURI;
      imgPreview.style.display = 'block';
    } else {
      imgPreview.style.display = 'none';
      pdfCanvas.style.display  = 'block';
      const buf = dataURItoArrayBuffer(dataURI);
      pdfDoc = await pdfjsLib.getDocument({ data: buf }).promise;
    }

    // Show workspace
    uploadSection.style.display = 'none';
    workspace.classList.remove('hidden');
    newAnalysisBtn.classList.remove('hidden');

    editor.innerHTML = ''; // reset avant navigateTo pour ne pas capturer le placeholder
    navigateTo(0);
    showToast(`OCR complete · ${totalPages} page(s) extracted.`, 'ok');

  } catch (err) {
    console.error('[OCRLearning]', err);
    if (err.status === 401) { showToast('Invalid API key (401).', 'err'); showApiModal(); }
    else showToast(err.message || 'OCR error — check the console.', 'err');
  } finally {
    dropZone.style.display = 'block';
    uploadLoading.style.display = 'none';
    fileInput.value = '';
  }
}

// ─── FILE READING ────────────────────────────────────────────────────────────
function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload  = () => resolve(r.result);
    r.onerror = () => reject(new Error('Failed to read file.'));
    r.readAsDataURL(file);
  });
}

function dataURItoArrayBuffer(dataURI) {
  const b64 = dataURI.split(',')[1];
  const bin = atob(b64);
  const buf = new ArrayBuffer(bin.length);
  const arr = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return buf;
}

// ─── TEXT UTILITIES ──────────────────────────────────────────────────────────

/** Normalize an API header/footer field (string, object with .text or .markdown). */
function extractText(val) {
  if (!val) return '';
  if (typeof val === 'string') return val.trim();
  if (val.text)     return String(val.text).trim();
  if (val.markdown) return String(val.markdown).trim();
  return String(val).trim();
}

/** Strip page-number artefacts — universal, works with any Unicode script.
 *  Uses \p{Nd} (any decimal digit) and \p{Pd} (any dash) with the u flag.
 */
function cleanPageNumbers(md) {
  // ── Phase 1 : regex chain ────────────────────────────────────────────────
  let result = md
    // Normalize line endings (Windows \r\n → \n)
    .replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    // Mistral OCR HTML markers (<!-- page break -->, etc.)
    .replace(/<!--[\s\S]*?-->/g, '')
    // [page …] markers on their own line
    .replace(/^\[page[^\]]*\][ \t]*$/ugim, '')
    // Strip markdown bold/italic from short lines before pattern matching
    .replace(/^[ \t]*\*{1,3}([\p{Nd}\p{L}\s\p{Pd}\/·\.]{1,70})\*{1,3}[ \t]*$/ugm, '$1')
    // Strip markdown heading markers from short lines (# ## ###)
    .replace(/^#{1,6}[ \t]+([\p{Nd}\p{Pd}\p{L}\s\/·\.]{1,70})[ \t]*$/ugm, '$1')
    // Any digit(s) alone on a line, optionally wrapped in Unicode dashes
    .replace(/^[ \t]*[\p{Pd}]?\s*\p{Nd}+\s*[\p{Pd}]?\s*$/ugm, '')
    // Universal fraction: "7/146", "٧/١٤٦", "3 / 10"
    .replace(/^[ \t]*\p{Nd}+\s*[\/\u060C]\s*\p{Nd}+\s*$/ugm, '')
    // Pattern A — "— Page 21 / 245 —", "p. 3/10", "- ١٤/٢٤٥ -"
    .replace(/^[ \t]*[\p{Pd}]?\s*[\p{L}]{0,8}\.?\s*\p{Nd}+\s*[\/·]\s*\p{Nd}+\s*[\p{Pd}]?[ \t]*$/ugm, '')
    // Pattern B — "٢١ الفضيل بن عياض" (digits then letters/spaces only)
    .replace(/^[ \t]*\p{Nd}+\s+[\p{L}][\p{L}\s]{1,48}[ \t]*$/ugm, '')
    // Pattern B reverse — "Chapitre Un 5"
    .replace(/^[ \t]*[\p{L}][\p{L}\s]{1,48}\s+\p{Nd}+[ \t]*$/ugm, '')
    // Inline footnote markers: [^1], ^1^, superscripts ¹²³…
    .replace(/\[\^\d+\]|\^\d+\^|[¹²³⁴⁵⁶⁷⁸⁹⁰]+/g, '')
    // Collapse 3+ blank lines → 2
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  // ── Phase 2 : separator-based footnote removal ───────────────────────────
  // isSep: line made only of dashes / underscores / asterisks (spaces ignored)
  const isSep = s => {
    const t = s.trim().replace(/[\s\u00A0\u200B]+/g, '');
    // Only dashes/underscores = footnote separator. Asterisks/stars are
    // decorative section markers in Arabic books — never treat them as separators.
    return t.length >= 2 && /^[-—–\u2015_─━═\u2500-\u257F]+$/.test(t);
  };
  // isRef: numbered footnote reference — (1), 1., [1], (١), ١. etc.
  // Max 2 digits: footnotes are never > 99; 3-digit numbers are TOC page refs.
  const isRef = s => /^[ \t]*[\(\[]?\p{Nd}{1,2}[\)\].]\s/u.test(s);

  const lines = result.split('\n');
  let cutAt = -1;

  // Scan backwards: the LAST separator is the footnote one.
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!isSep(lines[i])) continue;
    const after = lines.slice(i + 1).filter(l => l.trim());
    if (after.length === 0 || isRef(after[0]) || after.length <= 30) {
      cutAt = i;
    }
    break; // only inspect the last separator
  }

  // ── Phase 3 : numbered refs at end of page — strict, no continuation lines ─
  // Only lines that START with a numbered ref are collected. This eliminates
  // false positives caused by short body-text lines (e.g. a sentence cut at a
  // page break). Multi-line footnote continuations may survive, but body text
  // is never deleted.
  if (cutAt < 0) {
    let footStart = -1;

    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (!line) continue;           // skip blank lines
      if (isRef(line)) {
        footStart = i;               // numbered ref — include
      } else {
        break;                       // anything else — stop immediately
      }
    }

    if (footStart >= 0) {
      // Pull in a separator line immediately before the refs if present
      let cut = footStart;
      let j   = footStart - 1;
      while (j >= 0 && !lines[j].trim()) j--;
      if (j >= 0 && isSep(lines[j])) cut = j;

      // Safety: only cut if the body before the footnote block represents
      // at least 30% of total non-empty lines. This prevents Phase 3 from
      // wiping TOC pages where ALL entries look like numbered refs.
      const totalNonEmpty = lines.filter(l => l.trim()).length;
      const bodyNonEmpty  = lines.slice(0, cut).filter(l => l.trim()).length;
      if (totalNonEmpty === 0 || bodyNonEmpty >= Math.ceil(totalNonEmpty * 0.3)) {
        cutAt = cut;
      }
    }
  }

  if (cutAt >= 0) {
    result = lines.slice(0, cutAt).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  // ── Phase 4 : remove orphaned separator lines ────────────────────────────
  // Only dashes/underscores — asterisks/stars are decorative markers, keep them.
  result = result.replace(/^[-—–_─━═\u2500-\u257F]{2,}[ \t]*$/gm, '')
                 .replace(/\n{3,}/g, '\n\n')
                 .trim();

  return result;
}

/** Remove lines that repeat across ≥ 25 % of pages (running headers/footers).
 *  Normalises each line before counting so that "٢١ الفضيل بن عياض" and
 *  "٢٢ الفضيل بن عياض" and "الفضيل بن عياض" all map to the same key and
 *  are counted — then removed — together.
 */
function removeRepeatedLines(pages) {
  if (pages.length < 2) return;

  // Strip leading/trailing Unicode digits, dashes and whitespace for comparison
  function normLine(line) {
    return line
      .replace(/^[\p{Nd}\p{Pd}\s]+/u, '')
      .replace(/[\p{Nd}\p{Pd}\s]+$/u, '')
      .trim();
  }

  // Count distinct pages that contain each *normalised* short line
  const freq = new Map();
  pages.forEach(pg => {
    const seen = new Set();
    pg.markdown.split('\n').forEach(raw => {
      const line = raw.trim();
      if (line.length === 0 || line.length >= 80) return;
      const norm = normLine(line);
      if (norm.length === 0) return;
      if (!seen.has(norm)) {
        seen.add(norm);
        freq.set(norm, (freq.get(norm) || 0) + 1);
      }
    });
  });

  // Threshold: present on at least 25 % of pages (minimum 2)
  const threshold = Math.max(2, Math.floor(pages.length * 0.25));
  const toRemove  = new Set(
    [...freq.entries()]
      .filter(([, count]) => count >= threshold)
      .map(([norm]) => norm)
  );

  if (toRemove.size === 0) return;

  // Remove original lines whose normalised form is in toRemove
  pages.forEach(pg => {
    pg.markdown = pg.markdown
      .split('\n')
      .filter(raw => {
        const line = raw.trim();
        if (line.length === 0 || line.length >= 80) return true;
        return !toRemove.has(normLine(line));
      })
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  });
}

/** Collect all headers/footers from every page and append them at the end of the last page. */
function appendHeadersFooters() {
  const entries = [];
  pages.forEach((pg, i) => {
    if (pg.header) entries.push({ label: `En-tête — p.${i + 1}`,      text: pg.header });
    if (pg.footer) entries.push({ label: `Pied de page — p.${i + 1}`, text: pg.footer });
  });
  if (entries.length === 0) return;

  let html = `<hr style="margin:1.5rem 0"/>
<h3 style="color:#3B82F6;font-size:0.9rem;font-weight:700;letter-spacing:0.03em;margin:0 0 0.75rem">
  En-têtes &amp; Pieds de page
</h3>`;

  entries.forEach(e => {
    html += `<p style="font-size:0.85rem;margin:0.3rem 0">
  <strong style="color:#374151">${e.label} :</strong>
  <span style="color:#6B7280">&nbsp;${e.text}</span>
</p>`;
  });

  const last = pages[pages.length - 1];
  const base = last.editedHtml !== null ? last.editedHtml : marked.parse(last.markdown);
  last.editedHtml = base + html;

  // If the user is already viewing the last page, refresh the editor
  if (currentPage === pages.length - 1) editor.innerHTML = last.editedHtml;
}

// ─── MISTRAL OCR API ─────────────────────────────────────────────────────────
async function callMistralOCR(apiKey, dataURI, mimeType) {
  const doc = mimeType.startsWith('image/')
    ? { type: 'image_url',    image_url: dataURI }
    : { type: 'document_url', document_url: dataURI };

  const res = await fetch(OCR_ENDPOINT, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: OCR_MODEL, document: doc, extract_header: true, extract_footer: true })
  });

  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const b = await res.json(); msg = b.message || b.error || msg; } catch {}
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

// ─── PDF RENDERING ───────────────────────────────────────────────────────────
async function renderPdfPage(num) {
  if (!pdfDoc) return;
  pdfLoading.classList.remove('hidden');
  try {
    const page = await pdfDoc.getPage(num);
    const panelW = sourcePanel.clientWidth > 0 ? sourcePanel.clientWidth - 40 : 560;
    const vp0    = page.getViewport({ scale: 1 });
    const scale  = Math.min(panelW / vp0.width, 2.5);
    const vp     = page.getViewport({ scale });

    pdfCanvas.width  = vp.width;
    pdfCanvas.height = vp.height;
    const ctx = pdfCanvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
  } finally {
    pdfLoading.classList.add('hidden');
  }
}

// ─── PAGE NAVIGATION ─────────────────────────────────────────────────────────
function saveCurrentPage() {
  if (pages[currentPage]) pages[currentPage].editedHtml = editor.innerHTML;
}

function navigateTo(idx) {
  saveCurrentPage();
  currentPage = Math.max(0, Math.min(idx, totalPages - 1));

  // Source panel
  if (!fileIsImage && pdfDoc) renderPdfPage(currentPage + 1);

  // Editor
  const pg = pages[currentPage];
  if (pg.editedHtml !== null) {
    editor.innerHTML = pg.editedHtml;
  } else {
    editor.innerHTML = marked.parse(pg.markdown);
    pg.editedHtml = editor.innerHTML;
  }

  // Nav controls
  currentPageEl.value   = currentPage + 1;
  currentPageEl.max     = totalPages;
  totalPagesEl.textContent  = totalPages;
  prevBtn.disabled = currentPage === 0;
  nextBtn.disabled = currentPage === totalPages - 1;
}

prevBtn.addEventListener('click', () => navigateTo(currentPage - 1));
nextBtn.addEventListener('click', () => navigateTo(currentPage + 1));

// Go-to-page input
currentPageEl.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const n = parseInt(currentPageEl.value, 10);
    if (!isNaN(n)) navigateTo(n - 1);
    currentPageEl.blur();
  }
  if (e.key === 'Escape') { currentPageEl.value = currentPage + 1; currentPageEl.blur(); }
});
currentPageEl.addEventListener('blur', () => {
  const n = parseInt(currentPageEl.value, 10);
  if (!isNaN(n) && n - 1 !== currentPage) navigateTo(n - 1);
  else currentPageEl.value = currentPage + 1; // reset if invalid
});
currentPageEl.addEventListener('focus', () => currentPageEl.select());

// Keyboard shortcuts for navigation
document.addEventListener('keydown', e => {
  if (!workspace.classList.contains('hidden')) {
    if (e.altKey && e.key === 'ArrowLeft'  || e.key === 'PageUp')   { e.preventDefault(); navigateTo(currentPage - 1); }
    if (e.altKey && e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); navigateTo(currentPage + 1); }
  }
});

// ─── NEW ANALYSIS ────────────────────────────────────────────────────────────
newAnalysisBtn.addEventListener('click', () => {
  if (!confirm('Start a new analysis? Unsaved changes will be lost.')) return;
  pages = []; currentPage = 0; totalPages = 0;
  pdfDoc = null; fileIsImage = false;
  editor.innerHTML = '';
  pdfCanvas.style.display  = 'none';
  imgPreview.style.display = 'none';
  imgPreview.src = '';
  workspace.classList.add('hidden');
  newAnalysisBtn.classList.add('hidden');
  uploadSection.style.display = '';
  fileInput.value = '';
});

// ─── RICH TEXT EDITING ───────────────────────────────────────────────────────

// Save selection whenever user interacts with editor
editor.addEventListener('mouseup',  saveSelection);
editor.addEventListener('keyup',    saveSelection);
editor.addEventListener('focus',    saveSelection);

function saveSelection() {
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0 && editor.contains(sel.anchorNode)) {
    savedRange = sel.getRangeAt(0).cloneRange();
  }
}

function restoreSelection() {
  if (!savedRange) return false;
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(savedRange);
  return true;
}

// ── Block format (H1, H2, H3, P) ────────────────────────────────────────────
$$('.fmt-btn[data-block]').forEach(btn => {
  btn.addEventListener('mousedown', e => e.preventDefault()); // keep focus in editor
  btn.addEventListener('click', () => {
    restoreSelection();
    document.execCommand('formatBlock', false, btn.dataset.block);
    editor.focus();
    saveCurrentPage();
    updateToolbarState();
  });
});

// ── Inline format (bold, italic) ─────────────────────────────────────────────
$$('.fmt-btn[data-cmd]').forEach(btn => {
  btn.addEventListener('mousedown', e => e.preventDefault());
  btn.addEventListener('click', () => {
    restoreSelection();
    document.execCommand(btn.dataset.cmd);
    editor.focus();
    saveCurrentPage();
  });
});

// ── Highlight swatches ───────────────────────────────────────────────────────
$$('.hl-swatch').forEach(swatch => {
  swatch.addEventListener('mousedown', e => e.preventDefault());
  swatch.addEventListener('click', () => {
    if (!restoreSelection()) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) { showToast('Select text first to highlight.', 'err'); return; }

    const color = swatch.dataset.color;
    const range = sel.getRangeAt(0);

    if (color === '') {
      removeHighlight(range);
    } else {
      applyHighlight(range, color);
    }
    editor.focus();
    saveCurrentPage();
  });
});

function applyHighlight(range, color) {
  const span = document.createElement('span');
  span.style.backgroundColor = color;
  span.style.borderRadius    = '2px';
  span.style.padding         = '0 1px';
  try {
    range.surroundContents(span);
  } catch {
    // Selection spans multiple elements — extract & rewrap
    span.appendChild(range.extractContents());
    range.insertNode(span);
  }
}

function removeHighlight(range) {
  const ancestor = range.commonAncestorContainer;
  const root = ancestor.nodeType === 1 ? ancestor : ancestor.parentElement;
  if (!root) return;
  root.querySelectorAll('span[style]').forEach(span => {
    if (range.intersectsNode(span) && span.style.backgroundColor) {
      span.style.backgroundColor = '';
      span.style.padding = '';
      // Unwrap if no remaining style
      if (!span.getAttribute('style') || !span.getAttribute('style').trim()) {
        const parent = span.parentNode;
        while (span.firstChild) parent.insertBefore(span.firstChild, span);
        parent.removeChild(span);
      }
    }
  });
}

// ── Toolbar active state ─────────────────────────────────────────────────────
document.addEventListener('selectionchange', updateToolbarState);

function updateToolbarState() {
  const sel = window.getSelection();
  if (!sel || !sel.anchorNode || !editor.contains(sel.anchorNode)) return;
  let node = sel.anchorNode;
  while (node && node !== editor) {
    const tag = node.nodeName && node.nodeName.toLowerCase();
    $$('.fmt-btn[data-block]').forEach(b => {
      b.classList.toggle('active', b.dataset.block === tag);
    });
    if (['h1','h2','h3','p','div'].includes(tag)) break;
    node = node.parentNode;
  }
}

// ─── TOC ─────────────────────────────────────────────────────────────────────
tocBtn.addEventListener('click', () => {
  saveCurrentPage();
  renderToc();
  tocModal.classList.remove('hidden');

// "Couper jusqu'à la fin" — supprime depuis le curseur jusqu'à la fin de l'éditeur
});
document.getElementById('cutToEndBtn').addEventListener('click', () => {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !editor.contains(sel.anchorNode)) {
    showToast('Cliquez d\'abord dans le texte à l\'endroit de la coupure.', 'err');
    return;
  }
  const range = sel.getRangeAt(0);
  // Extend the range to the very end of the editor
  const endRange = document.createRange();
  endRange.selectNodeContents(editor);
  range.setEnd(endRange.endContainer, endRange.endOffset);
  range.deleteContents();
  saveCurrentPage();
  showToast('Contenu supprimé jusqu\'à la fin de la page.');
});

[closeTocBtn, closeTocFooter].forEach(btn => {
  btn.addEventListener('click', () => tocModal.classList.add('hidden'));
});
tocModal.addEventListener('click', e => {
  if (e.target === tocModal) tocModal.classList.add('hidden');
});

function collectHeadings() {
  const list = [];
  pages.forEach((pg, pageIdx) => {
    const html = pg.editedHtml !== null ? pg.editedHtml : marked.parse(pg.markdown);
    const tmp  = document.createElement('div');
    tmp.innerHTML = html;
    tmp.querySelectorAll('h1, h2, h3').forEach(h => {
      list.push({ level: parseInt(h.tagName[1]), text: h.textContent.trim(), page: pageIdx });
    });
  });
  return list;
}

function renderToc() {
  const headings = collectHeadings();
  if (headings.length === 0) {
    tocContent.innerHTML = '<p class="toc-empty">No headings (H1/H2/H3) found. Apply heading styles in the editor first.</p>';
    return;
  }
  const ul = document.createElement('ul');
  headings.forEach(h => {
    const li = document.createElement('li');
    li.className = `toc-h${h.level}`;
    const label = document.createElement('span');
    label.textContent = h.text;
    const pg = document.createElement('span');
    pg.className = 'toc-page';
    pg.textContent = `p.${h.page + 1}`;
    li.append(label, pg);
    li.addEventListener('click', () => {
      tocModal.classList.add('hidden');
      navigateTo(h.page);
    });
    ul.appendChild(li);
  });
  tocContent.innerHTML = '';
  tocContent.appendChild(ul);
}

insertTocBtn.addEventListener('click', () => {
  saveCurrentPage();
  const headings = collectHeadings();
  if (headings.length === 0) { showToast('No headings found to build a TOC.', 'err'); return; }

  let tocHtml = `<div style="margin-bottom:1.5rem;padding:1rem;background:#F8FAFF;border-left:3px solid #3B82F6;border-radius:4px">
    <strong style="font-size:1rem;display:block;margin-bottom:0.75rem">Table des matières</strong>
    <ul style="list-style:none;padding:0;margin:0">`;

  headings.forEach(h => {
    const indent = (h.level - 1) * 18;
    const weight = h.level === 1 ? '700' : '400';
    const color  = h.level === 3 ? '#6B7280' : '#1F2937';
    tocHtml += `<li style="padding:0.2rem 0 0.2rem ${indent}px;font-weight:${weight};color:${color};font-size:0.875rem">
      ${h.text} <span style="color:#9CA3AF;font-size:0.75rem">— p.${h.page + 1}</span>
    </li>`;
  });
  tocHtml += `</ul></div><hr style="margin:1rem 0"/>`;

  // Prepend to first page
  pages[0].editedHtml = tocHtml + (pages[0].editedHtml || marked.parse(pages[0].markdown));
  if (currentPage === 0) editor.innerHTML = pages[0].editedHtml;

  tocModal.classList.add('hidden');
  showToast('TOC inserted at the start of the document.', 'ok');
});

// ─── DOCX EXPORT ─────────────────────────────────────────────────────────────
exportDocxBtn.addEventListener('click', exportDocx);

function exportDocx() {
  saveCurrentPage();

  // Pre-render all unvisited pages so editedHtml is never null
  // (ensures cleaned markdown is used, not raw markdown with artefacts)
  pages.forEach(pg => {
    if (pg.editedHtml === null) pg.editedHtml = marked.parse(pg.markdown);
  });

  if (typeof htmlDocx === 'undefined') {
    showToast('DOCX library not loaded. Check your internet connection.', 'err');
    return;
  }

  // Build TOC header
  const headings = collectHeadings();
  let tocSection = '';
  if (headings.length > 0) {
    tocSection = `<div style="margin-bottom:36pt">
      <h2 style="font-size:16pt;margin-bottom:14pt">Table des matières</h2>
      <ul style="list-style:none;padding:0;margin:0">`;
    headings.forEach(h => {
      const indent = (h.level - 1) * 18;
      const weight = h.level === 1 ? 'bold' : 'normal';
      tocSection += `<li style="padding:3pt 0 3pt ${indent}pt;font-weight:${weight};font-size:11pt">
        ${h.text}<span style="color:#9CA3AF"> — p.${h.page + 1}</span>
      </li>`;
    });
    tocSection += `</ul></div><hr style="margin:24pt 0"/>`;
  }

  // Concatenate all pages — strip any <hr> tags (orphaned separators or page
  // dividers) so they don't produce VML lines in the exported DOCX.
  let bodyHtml = '';
  pages.forEach((pg, i) => {
    let html = pg.editedHtml !== null ? pg.editedHtml : marked.parse(pg.markdown);
    html = html.replace(/<hr\b[^>]*>/gi, '');   // remove every <hr> from content
    if (i > 0 && totalPages > 1) {
      bodyHtml += `<p style="page-break-before:always;margin:0"></p>`;
    }
    bodyHtml += html;
  });

  const fullDoc = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  body  { font-family: Calibri, Arial, sans-serif; font-size: 11pt; line-height: 1.6; color: #1F2937; }
  h1    { font-size: 20pt; font-weight: bold; margin: 20pt 0 8pt; color: #0a0a0a; }
  h2    { font-size: 15pt; font-weight: bold; margin: 16pt 0 6pt; color: #111827; }
  h3    { font-size: 13pt; font-weight: bold; margin: 12pt 0 5pt; color: #1f2937; }
  p     { margin: 0 0 8pt; }
  ul, ol{ padding-left: 18pt; margin-bottom: 8pt; }
  li    { margin-bottom: 3pt; }
  table { border-collapse: collapse; width: 100%; margin: 8pt 0; }
  th, td{ border: 1pt solid #D1D5DB; padding: 4pt 6pt; font-size: 10pt; }
  th    { background: #F9FAFB; font-weight: bold; }
  hr    { border: none; border-top: 1pt solid #E5E7EB; margin: 10pt 0; }
  code  { font-family: 'Courier New', monospace; font-size: 9pt; background: #F3F4F6; }
  span[style*="background-color"] { padding: 1pt 2pt; border-radius: 2pt; }
</style></head><body>${tocSection}${bodyHtml}</body></html>`;

  try {
    const blob = htmlDocx.asBlob(fullDoc);
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), {
      href:     url,
      download: (fileName.replace(/\.[^.]+$/, '') || 'document') + '_OCRLearning.docx'
    });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    showToast('DOCX downloaded successfully!', 'ok');
  } catch (err) {
    console.error('[OCRLearning] DOCX export error:', err);
    showToast('Export failed — check the console.', 'err');
  }
}

// ─── TOAST ───────────────────────────────────────────────────────────────────
let toastTimer = null;
function showToast(msg, type = '') {
  toastEl.textContent = msg;
  toastEl.className   = 'toast' + (type ? ' ' + type : '');
  toastEl.style.display = 'block';
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.style.display = 'none'; }, 4500);
}

// ─── INIT ────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  if (!getApiKey()) showApiModal();
});
