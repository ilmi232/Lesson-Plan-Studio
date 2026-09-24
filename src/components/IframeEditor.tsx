import React, { useEffect, useRef, useCallback, useState } from "react";
import { useStore } from "../store";
import { sanitizeFragment } from "../sanitize";
import { stripPrintChrome, stripRenderedChrome, releaseArtificialHeights, fitToPageWidth } from "../cleanup";
import { serializeDoc, prepareForEditor, writeToIframe, onceParsed } from "../editorDocument";
import { callGemini, getGeminiKey, describeGeminiError } from "../gemini";
import { restructureDocument, type RestructureResult } from "../restructure";
import { flattenDocument } from "../flatten";
import { computePageStarts, layoutSheets, removeSheetGaps, sheetHeightPx, SHEET_GAP_PX, PRINT_MARGIN_MM, type Sheet } from "../pagination";
import { RestructurePreview } from "./RestructurePreview";
import { buildGrid, freezeColumnWidths, insertColumnAfter, insertRowAfter, deleteColumns, deleteRows } from "../tableOps";
import { CopyPromptButton } from "./CopyPromptButton";
import {
  Bold, Italic, Underline as UnderlineIcon, List, ListOrdered,
  Undo, Redo, Wand2, Scissors, Sparkles, FileCheck2, RotateCcw, ChevronDown, Table2
} from "lucide-react";

interface IframeEditorProps {
  planId: string;
}

const PAGE_BREAK_CSS = `
  /* Hide scrollbars without breaking layout */
  html { overflow-x: hidden; }
  body { overflow-x: hidden; }
  ::-webkit-scrollbar { display: none; }

  /* Fix common AI-generated HTML layout issues inside editor */
  .no-print { display: none !important; }

  /* The iframe is sized to its content, so viewport-based heights (min-h-screen, 100vh)
     would grow with it forever */
  html, body { height: auto !important; min-height: 0 !important; }

  /* The page itself is paper: a web page's grey/colored background around its "paper"
     container would show as strips beside the text (and waste ink) */
  html, body { background: #fff !important; }

  /* Same margins as the printed page (@page in pagination.ts), so lines wrap and page
     guides fall where they will on paper */
  @media screen { html { padding: ${PRINT_MARGIN_MM}mm !important; } }

  /* Neutralize fixed/absolute positioning that causes text overlap in iframe */
  body > div[style*="position: fixed"],
  body > div[style*="position:fixed"],
  body > header[style*="position: fixed"],
  body > header[style*="position:fixed"],
  [class*="sticky"], [class*="fixed"] { 
    position: relative !important; 
    top: auto !important; 
    left: auto !important; 
    right: auto !important; 
    bottom: auto !important; 
    z-index: auto !important;
  }

  /* Prevent page-simulation containers from clipping content */
  [class*="page"], [class*="sheet"], [class*="a4"], [class*="paper"] {
    height: auto !important;
    min-height: auto !important;
    overflow: visible !important;
    page-break-inside: auto !important;
    break-inside: auto !important;
  }

  /* Spacing between tables */
  table { margin-bottom: 12px; }

  .page-break {
    display: block !important;
    height: 24px !important;
    background-color: #f3f4f6 !important;
    border-top: 2px dashed #9ca3af !important;
    border-bottom: 2px dashed #9ca3af !important;
    margin: 20px 0 !important;
    text-align: center !important;
    color: #6b7280 !important;
    font-size: 12px !important;
    font-weight: bold !important;
    line-height: 20px !important;
    page-break-after: always !important;
    break-after: page !important;
    user-select: none !important;
    pointer-events: none !important;
    position: static !important;
  }
  .page-break::before {
    content: "✂ BATAS HALAMAN MANUAL — hapus: Backspace di awal halaman berikutnya";
  }
  @media print {
    .page-break {
      height: 0 !important; border: none !important;
      background: transparent !important; color: transparent !important; margin: 0 !important;
    }
    .page-break::before { content: ""; }
  }
`;

function attachTableResizer(doc: Document) {
  let isResizingCol = false;
  let isResizingRow = false;
  let currentCell: HTMLElement | null = null;
  let resizeMode: "col" | "row" | null = null;
  let startX = 0;
  let startY = 0;

  doc.addEventListener("mousemove", (e) => {
    if (isResizingCol) {
      const state = (doc as any)._resizeCols;
      if (!state) return;
      // Widths are percentages: move the border between the two columns, keeping their sum
      const pair = state.startLeft + state.startRight;
      const minPct = (20 / state.tableWidth) * 100;
      const delta = ((e.clientX - startX) / state.tableWidth) * 100;
      const left = Math.min(Math.max(state.startLeft + delta, minPct), pair - minPct);
      state.leftCol.style.width = `${left.toFixed(2)}%`;
      state.rightCol.style.width = `${(pair - left).toFixed(2)}%`;
      return;
    }
    if (isResizingRow) {
      const state = (doc as any)._resizeRow;
      if (!state) return;
      const dy = e.clientY - startY;
      state.row.style.height = `${Math.max(20, state.startHeight + dy)}px`;
      return;
    }

    const target = e.target as HTMLElement;
    // Header copies on continuation sheets (data-agy-gap) are editor-only, not real cells
    if (!target || (target.tagName !== "TD" && target.tagName !== "TH") || target.closest("[data-agy-gap]")) {
      if (currentCell) { currentCell.style.cursor = ""; currentCell = null; resizeMode = null; }
      return;
    }
    const rect = target.getBoundingClientRect();
    const nearRight  = e.clientX > rect.right  - 8 && e.clientX <= rect.right;
    const nearBottom = e.clientY > rect.bottom - 8 && e.clientY <= rect.bottom;
    const nearLeft   = e.clientX < rect.left   + 8 && e.clientX >= rect.left;

    if (nearRight && nearBottom) {
      target.style.cursor = "row-resize"; currentCell = target; resizeMode = "row";
    } else if (nearRight) {
      target.style.cursor = "col-resize"; currentCell = target; resizeMode = "col";
    } else if (nearBottom) {
      target.style.cursor = "row-resize"; currentCell = target; resizeMode = "row";
    } else if (nearLeft) {
      const prev = target.previousElementSibling as HTMLElement | null;
      if (prev) { target.style.cursor = "col-resize"; currentCell = prev; resizeMode = "col"; }
      else { target.style.cursor = ""; currentCell = null; resizeMode = null; }
    } else {
      target.style.cursor = ""; currentCell = null; resizeMode = null;
    }
  });

  doc.addEventListener("mousedown", (e) => {
    if (!currentCell || !resizeMode) return;
    const table = currentCell.closest("table") as HTMLTableElement | null;
    if (!table) return;

    if (resizeMode === "col") {
      // Visual column from the grid, so merged cells (colspan/rowspan) are accounted for
      const { pos, width } = buildGrid(table);
      const colIndex = pos.get(currentCell as HTMLTableCellElement)?.col ?? 0;
      const leftColIdx = colIndex + ((currentCell as HTMLTableCellElement).colSpan || 1) - 1;
      // The table's outer right edge has no neighbour to trade width with; the table keeps its width
      if (leftColIdx + 1 >= width) return;
      const cols = freezeColumnWidths(table);
      isResizingCol = true;
      startX = e.clientX;
      (doc as any)._resizeCols = {
        leftCol: cols[leftColIdx],
        rightCol: cols[leftColIdx + 1],
        startLeft: parseFloat(cols[leftColIdx].style.width),
        startRight: parseFloat(cols[leftColIdx + 1].style.width),
        tableWidth: table.getBoundingClientRect().width,
      };
      e.preventDefault();
    } else if (resizeMode === "row") {
      isResizingRow = true;
      startY = e.clientY;
      const row = currentCell.parentElement as HTMLTableRowElement;
      const getH = (el: HTMLElement) =>
        parseInt(el.style.height || doc.defaultView?.getComputedStyle(el).height || "0", 10);
      (doc as any)._resizeRow = { row, startHeight: getH(row) || getH(currentCell) };
      e.preventDefault();
    }
  });

  doc.addEventListener("mouseup", () => {
    if (isResizingCol || isResizingRow) {
      isResizingCol = false; isResizingRow = false;
      currentCell = null; resizeMode = null;
      (doc as any)._resizeCols = null; (doc as any)._resizeRow = null;
      doc.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
}

const BLOCK = "p, div, li, h1, h2, h3, h4, h5, h6, td, th, section, article, blockquote, pre";

// Backspace at the very start of the block right after a manual page break (Delete: at the end
// of the block right before it) removes the break, like deleting a page break in Word.
function removeAdjacentPageBreak(doc: Document, direction: "before" | "after"): boolean {
  const sel = doc.getSelection();
  if (!sel || !sel.isCollapsed || sel.rangeCount === 0) return false;
  const caret = sel.getRangeAt(0);
  const start = caret.startContainer.nodeType === Node.ELEMENT_NODE
    ? (caret.startContainer as Element) : caret.startContainer.parentElement;
  const block = start?.closest(BLOCK);
  if (!block || block === doc.body) return false;
  // Nothing between the caret and the block edge
  const probe = doc.createRange();
  probe.selectNodeContents(block);
  if (direction === "before") probe.setEnd(caret.startContainer, caret.startOffset);
  else probe.setStart(caret.startContainer, caret.startOffset);
  if (probe.toString().replace(/\u200b/g, "").trim()) return false;
  let node: Element | null = block;
  while (node && node !== doc.body) {
    let sibling = direction === "before" ? node.previousElementSibling : node.nextElementSibling;
    while (sibling?.hasAttribute("data-agy-gap")) {
      sibling = direction === "before" ? sibling.previousElementSibling : sibling.nextElementSibling;
    }
    if (sibling) {
      if (!sibling.classList.contains("page-break")) return false;
      sibling.remove();
      return true;
    }
    node = node.parentElement;
  }
  return false;
}

const MenuItem: React.FC<{ icon: React.ReactNode; title: string; hint: string; onClick: () => void }> = ({ icon, title, hint, onClick }) => (
  <button onClick={onClick} className="w-full flex items-start gap-2.5 px-3 py-2 text-left hover:bg-emerald-50">
    <span className="mt-0.5 text-emerald-700">{icon}</span>
    <span><span className="block font-medium text-gray-800">{title}</span><span className="block text-xs text-gray-500">{hint}</span></span>
  </button>
);

export const IframeEditor: React.FC<IframeEditorProps> = ({ planId }) => {
  const { plans, updatePlan, replaceContent, restorePreviousVersion, paperSize, sheetView, setSheetView } = useStore();
  const plan = plans.find((p) => p.id === planId);
  // One AI task at a time; the label shows progress on the button that started it
  const [aiTask, setAiTask] = useState<{ kind: "flatten" | "table" | "doc"; label: string } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: Event) => { if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false); };
    // Clicks inside the editor iframe don't reach this document; they blur the window instead
    const closeOnBlur = () => setMenuOpen(false);
    document.addEventListener("mousedown", close);
    window.addEventListener("blur", closeOnBlur);
    return () => { document.removeEventListener("mousedown", close); window.removeEventListener("blur", closeOnBlur); };
  }, [menuOpen]);
  const [preview, setPreview] = useState<{ before: string; after: string; result: RestructureResult } | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Page layout, recomputed shortly after changes: separate sheets (spacers pushed into the
  // document, see pagination.ts) or, in continuous view, guide lines where pages will start.
  const [pageLayout, setPageLayout] = useState<{ sheets: Sheet[]; guides: number[] }>({ sheets: [], guides: [] });
  const layoutOptions = useRef({ paperSize, sheetView });
  const sheetBottom = useRef(0);
  const layoutTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const adjustHeightRef = useRef<(relayout?: boolean) => void>(() => {});
  function runLayout() {
    const doc = iframeRef.current?.contentDocument;
    if (!doc?.body) return;
    const { paperSize: paper, sheetView: sheets } = layoutOptions.current;
    if (sheets) {
      const layout = layoutSheets(doc, paper);
      sheetBottom.current = layout.totalHeight;
      setPageLayout({ sheets: layout.sheets, guides: [] });
    } else {
      removeSheetGaps(doc);
      sheetBottom.current = 0;
      setPageLayout({ sheets: [], guides: computePageStarts(doc, paper).map(Math.round) });
    }
    // Our own spacer changes must not trigger another layout round
    (doc as any)._heightObserver?.takeRecords();
    adjustHeightRef.current(false);
  }
  function scheduleLayout() {
    clearTimeout(layoutTimer.current);
    layoutTimer.current = setTimeout(runLayout, 250);
  }
  useEffect(() => {
    layoutOptions.current = { paperSize, sheetView };
    scheduleLayout();
    return () => clearTimeout(layoutTimer.current);
  }, [paperSize, sheetView]); // eslint-disable-line react-hooks/exhaustive-deps

  // Size the iframe to its content (and, in sheet view, to the last full sheet). Measured from the
  // content itself, not scrollHeight: the document's scrollHeight is never smaller than the
  // iframe, so it could only ever grow (every keystroke added 60px of blank space at the end).
  const adjustHeight = useCallback((relayout = true) => {
    const iframe = iframeRef.current;
    const doc = iframe?.contentDocument;
    const win = doc?.defaultView;
    if (!iframe || !doc?.body || !win) return;
    const scrollContainer = document.getElementById("editor-scroll-container");
    const savedScroll = scrollContainer?.scrollTop ?? 0;
    const range = doc.createRange();
    range.selectNodeContents(doc.body);
    const bodyStyle = win.getComputedStyle(doc.body);
    const contentBottom = range.getBoundingClientRect().bottom + win.scrollY +
      parseFloat(bodyStyle.paddingBottom) + parseFloat(bodyStyle.marginBottom) +
      parseFloat(win.getComputedStyle(doc.documentElement).paddingBottom);
    const target = sheetBottom.current > 0
      ? Math.max(Math.ceil(sheetBottom.current), Math.ceil(contentBottom))
      : Math.max(Math.ceil(contentBottom), 300) + 60;
    const current = parseInt(iframe.style.height || "0", 10);
    if (Math.abs(target - current) > 2) iframe.style.height = `${target}px`;
    if (scrollContainer && savedScroll > 0) scrollContainer.scrollTop = savedScroll;
    if (relayout) scheduleLayout();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { adjustHeightRef.current = adjustHeight; }, [adjustHeight]);

  // Word-like keys: Ctrl+Enter inserts a page break; Backspace at the start of the page after a
  // manual break (or Delete at the end of the page before it) removes the break.
  const insertPageBreakRef = useRef<() => void>(() => {});

  const setupIframe = useCallback((doc: Document) => {
    doc.designMode = "on";

    doc.querySelector("#agy-style")?.remove();
    const style = doc.createElement("style");
    style.id = "agy-style";
    style.textContent = PAGE_BREAK_CSS;
    doc.head?.appendChild(style);

    if (!(doc as any)._tableResizerAttached) {
      attachTableResizer(doc);
      (doc as any)._tableResizerAttached = true;
    }

    const oldHandler = (doc as any)._inputHandler;
    if (oldHandler) doc.removeEventListener("input", oldHandler);
    const newHandler = () => {
      updatePlan(planId, serializeDoc(doc));
      adjustHeight();
    };
    doc.addEventListener("input", newHandler);
    (doc as any)._inputHandler = newHandler;

    const oldKeys = (doc as any)._keyHandler;
    if (oldKeys) doc.removeEventListener("keydown", oldKeys);
    const keyHandler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        insertPageBreakRef.current();
        return;
      }
      if ((e.key === "Backspace" || e.key === "Delete") && !e.ctrlKey && !e.metaKey && !e.altKey &&
          removeAdjacentPageBreak(doc, e.key === "Backspace" ? "before" : "after")) {
        e.preventDefault();
        doc.dispatchEvent(new Event("input", { bubbles: true }));
      }
    };
    doc.addEventListener("keydown", keyHandler);
    (doc as any)._keyHandler = keyHandler;

    const oldObserver = (doc as any)._heightObserver;
    if (oldObserver) oldObserver.disconnect();
    const observer = new MutationObserver(() => adjustHeight());
    observer.observe(doc.body, { childList: true, subtree: true, characterData: true, attributes: true });
    (doc as any)._heightObserver = observer;

    // Print toolbars only detectable once rendered; run again after the Tailwind CDN,
    // which generates its styles after DOMContentLoaded, has styled the page.
    const cleanRendered = () => {
      if (stripRenderedChrome(doc) + releaseArtificialHeights(doc) + fitToPageWidth(doc) > 0) {
        updatePlan(planId, serializeDoc(doc));
        adjustHeight();
      }
    };
    cleanRendered();
    const cleanTimer = setTimeout(cleanRendered, 1500);

    setTimeout(() => adjustHeight(), 150);
    setTimeout(() => adjustHeight(), 800);
    setTimeout(() => adjustHeight(), 2500);

    return () => {
      doc.removeEventListener("input", newHandler);
      observer.disconnect();
      clearTimeout(cleanTimer);
    };
  }, [planId, updatePlan, adjustHeight]);

  // A whole-document replacement remounts the iframe (new key) instead of reusing it:
  // doc.open() keeps the old window alive, and scripts from the previous document (e.g. the
  // Tailwind CDN) kept injecting their CSS into the new one.
  const [frameKey, setFrameKey] = useState(0);
  const pendingLoad = useRef<{ html: string; reason?: string; resolve: () => void } | null>(null);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !plan) return;
    const doc = iframe.contentDocument;
    if (!doc) return;
    const pending = pendingLoad.current;
    if (!pending && doc.body && doc.body.innerHTML.trim().length > 0) return;

    writeToIframe(iframe, prepareForEditor(pending ? pending.html : plan.content || ""));
    let cancelled = false;
    let cleanup: (() => void) | undefined;
    onceParsed(doc, () => {
      if (cancelled) return;
      if (pending) {
        pendingLoad.current = null;
        // Store before setupIframe: its print-toolbar cleanup may save again right away
        if (pending.reason) replaceContent(planId, serializeDoc(doc), pending.reason);
      }
      cleanup = setupIframe(doc);
      pending?.resolve();
    });
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [planId, frameKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const paperStyle: React.CSSProperties = (() => {
    switch (paperSize) {
      case "f4":     return { minHeight: "330.2mm", width: "215.9mm" };
      case "letter": return { minHeight: "279.4mm", width: "215.9mm" };
      case "legal":  return { minHeight: "355.6mm", width: "215.9mm" };
      default:       return { minHeight: "297mm",   width: "210mm"   };
    }
  })();

  const exec = (command: string, value?: string) => {
    iframeRef.current?.contentDocument?.execCommand(command, false, value);
    iframeRef.current?.contentDocument?.dispatchEvent(new Event("input", { bubbles: true }));
  };

  const getSelectedCell = (): HTMLTableCellElement | null => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc) return null;
    const sel = doc.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    let node: Node | null = sel.anchorNode;
    while (node && node.nodeName !== "TD" && node.nodeName !== "TH" && node.nodeName !== "BODY") {
      node = node.parentNode;
    }
    const cell = node && (node.nodeName === "TD" || node.nodeName === "TH") ? (node as HTMLTableCellElement) : null;
    // Header copies on continuation sheets are editor-only, not part of the table
    return cell && !cell.closest("[data-agy-gap]") ? cell : null;
  };

  const handleTableAction = (action: string) => {
    const cell = getSelectedCell();
    if (!cell) { alert("Klik di dalam tabel terlebih dahulu!"); return; }
    const table = cell.closest("table") as HTMLTableElement;
    switch (action) {
      case "addRow": insertRowAfter(table, cell); break;
      case "addCol": insertColumnAfter(table, cell); break;
      case "delRow":
        if (!deleteRows(table, cell)) table.remove();
        break;
      case "delCol":
        if (!deleteColumns(table, cell)) table.remove();
        break;
      case "delTable":
        // DOM edits are not covered by the Undo button, so confirm the destructive one
        if (!window.confirm("Hapus seluruh tabel ini? Tindakan ini tidak bisa di-undo.")) return;
        table.remove();
        break;
    }
    iframeRef.current?.contentDocument?.dispatchEvent(new Event("input", { bubbles: true }));
  };

  const handleInsertPageBreak = () => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc) return;
    const cell = getSelectedCell();
    if (cell) {
      const table = cell.closest("table");
      if (table) {
        const breakDiv = doc.createElement("div");
        breakDiv.className = "page-break";
        const spacer = doc.createElement("p");
        spacer.innerHTML = "<br>";
        table.after(breakDiv, spacer);
        doc.dispatchEvent(new Event("input", { bubbles: true }));
        return;
      }
    }
    exec("insertHTML", '<div class="page-break"></div><p><br></p>');
  };

  // Replace the whole document in the editor. With a reason, the current content is kept as
  // the plan's previous version so the teacher can undo from the toolbar.
  // Resolves once the new document is parsed and the editor is set up on it.
  const loadIntoEditor = (html: string, reason?: string) => new Promise<void>((resolve) => {
    pendingLoad.current = { html, reason, resolve };
    setFrameKey((k) => k + 1);
  });

  // Main "Rapikan Dokumen": no AI. Bakes the rendered look into inline styles and drops
  // Tailwind/classes; offers the AI step only for what it can't do (grid/flex pseudo-tables).
  const handleFlatten = async () => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc?.body || !plan) return;
    setMenuOpen(false);
    removeSheetGaps(doc);
    setAiTask({ kind: "flatten", label: "Merapikan..." });
    let pseudoTables = 0;
    try {
      const result = flattenDocument(doc, plan.title);
      pseudoTables = result.pseudoTables;
      await loadIntoEditor(result.html, "Rapikan Dokumen");
    } catch (err) {
      alert(`Gagal merapikan dokumen: ${err instanceof Error ? err.message : String(err)}\nDokumen tidak diubah.`);
      return;
    } finally {
      setAiTask(null);
    }
    if (pseudoTables > 0 && window.confirm(
      `Dokumen sudah dirapikan (klik "Kembalikan" untuk membatalkan).\n\n` +
      `Masih ada ${pseudoTables} tabel semu — kolom yang dibuat dari kotak grid/flex, bukan tabel asli, ` +
      `sehingga +Row/+Col dan geser kolom belum bisa dipakai.\n\n` +
      `Ubah menjadi tabel asli dengan AI? (butuh Gemini API key, ada pratinjau sebelum diterapkan)`
    )) {
      await handleAiRestructure();
    }
  };

  const handleRestoreVersion = () => {
    const reason = plan?.previousVersion?.reason;
    if (!window.confirm(`Kembalikan dokumen ke versi sebelum "${reason}"?\nPerubahan sejak itu akan hilang.`)) return;
    const previous = restorePreviousVersion(planId);
    if (previous !== null) loadIntoEditor(previous);
  };

  useEffect(() => { insertPageBreakRef.current = handleInsertPageBreak; });

  const handleMagicPaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      const cleaned = text.replace(/```html\s*/gi, "").replace(/```\s*/g, "").trim();
      const iframe = iframeRef.current;
      const doc = iframe?.contentDocument;
      if (!iframe || !doc) return;
      if (cleaned.toLowerCase().includes("<html")) {
        loadIntoEditor(cleaned, "Magic Paste");
      } else {
        const fragment = new DOMParser().parseFromString(cleaned, "text/html");
        stripPrintChrome(fragment.body);
        exec("insertHTML", sanitizeFragment(fragment.body.innerHTML));
      }
    } catch {
      alert("Gagal membaca clipboard. Pastikan izin clipboard sudah diberikan.");
    }
  };

  const handleAiFixTable = async () => {
    setMenuOpen(false);
    const doc = iframeRef.current?.contentDocument;
    if (!doc) return;
    const cell = getSelectedCell();
    const targetTable: HTMLTableElement | null = cell
      ? (cell.closest("table") as HTMLTableElement)
      : (doc.querySelector("table") as HTMLTableElement | null);
    if (!targetTable) {
      alert("Tidak ada tabel yang ditemukan. Klik di dalam tabel terlebih dahulu.\n\nKalau tabelnya dibuat dari kotak-kotak <div> (bukan tabel asli), pakai \"Rapikan Dokumen (AI)\".");
      return;
    }
    const apiKey = getGeminiKey();
    if (!apiKey) return;
    removeSheetGaps(doc);
    setAiTask({ kind: "table", label: "Memproses..." });
    try {
      const prompt = `Kamu adalah asisten perapih tabel HTML untuk RPP (Rencana Pelaksanaan Pembelajaran).
Perbaiki tabel HTML di bawah ini agar:
1. Setiap kolom proporsional menggunakan width di <col> atau style inline
2. Tidak ada konten yang terpotong
3. Baris header tetap terbaca jelas
4. Gunakan style inline saja (tidak pakai class Tailwind)
5. Kembalikan HANYA kode HTML tabel saja (mulai <table> hingga </table>), tanpa penjelasan.

${targetTable.outerHTML}`;
      const fixedHtml = await callGemini(apiKey, prompt, {
        onRetry: (n) => setAiTask({ kind: "table", label: `Server sibuk, mencoba lagi (${n})...` }),
      });
      if (!fixedHtml.toLowerCase().includes("<table")) throw new Error("AI tidak mengembalikan tabel HTML yang valid.");
      const tmp = doc.createElement("div");
      tmp.innerHTML = sanitizeFragment(fixedHtml);
      const newTable = tmp.querySelector("table");
      if (newTable) {
        targetTable.replaceWith(newTable);
        doc.dispatchEvent(new Event("input", { bubbles: true }));
        adjustHeight();
      }
    } catch (err) {
      alert(describeGeminiError(err, "Tabel tidak diubah"));
    } finally {
      setAiTask(null);
    }
  };

  const handleAiRestructure = async () => {
    setMenuOpen(false);
    const doc = iframeRef.current?.contentDocument;
    if (!doc?.body || !plan) return;
    const apiKey = getGeminiKey();
    if (!apiKey) return;
    setAiTask({ kind: "doc", label: "Menyiapkan..." });
    removeSheetGaps(doc);
    // Edits made while the AI works would be lost when the result is applied
    doc.designMode = "off";
    try {
      const before = prepareForEditor(serializeDoc(doc));
      const result = await restructureDocument(doc, {
        apiKey,
        paperSize,
        title: plan.title,
        onProgress: (label) => setAiTask({ kind: "doc", label }),
      });
      setPreview({ before, after: prepareForEditor(result.html), result });
    } catch (err) {
      alert(describeGeminiError(err, "Dokumen tidak diubah"));
    } finally {
      doc.designMode = "on";
      setAiTask(null);
    }
  };

  const handleApplyRestructure = () => {
    if (!preview) return;
    loadIntoEditor(preview.result.html, "Rapikan Dokumen (AI)");
    setPreview(null);
  };

  if (!plan) return null;

  return (
    <div className="flex flex-col h-full items-center w-full">
      <div className="sticky top-0 z-10 bg-white border-b border-gray-200 p-2 flex flex-wrap gap-1.5 w-full justify-center shadow-sm">
        <button onClick={() => exec("bold")} className="p-2 rounded hover:bg-gray-100 text-gray-700" title="Bold"><Bold className="w-4 h-4" /></button>
        <button onClick={() => exec("italic")} className="p-2 rounded hover:bg-gray-100 text-gray-700" title="Italic"><Italic className="w-4 h-4" /></button>
        <button onClick={() => exec("underline")} className="p-2 rounded hover:bg-gray-100 text-gray-700" title="Underline"><UnderlineIcon className="w-4 h-4" /></button>
        <div className="w-px h-6 bg-gray-300 self-center mx-0.5" />
        <button onClick={() => exec("insertUnorderedList")} className="p-2 rounded hover:bg-gray-100 text-gray-700" title="Bullet List"><List className="w-4 h-4" /></button>
        <button onClick={() => exec("insertOrderedList")} className="p-2 rounded hover:bg-gray-100 text-gray-700" title="Numbered List"><ListOrdered className="w-4 h-4" /></button>
        <div className="w-px h-6 bg-gray-300 self-center mx-0.5" />
        <button onClick={() => exec("undo")} className="p-2 rounded hover:bg-gray-100 text-gray-700" title="Undo (Ctrl+Z)"><Undo className="w-4 h-4" /></button>
        <button onClick={() => exec("redo")} className="p-2 rounded hover:bg-gray-100 text-gray-700" title="Redo (Ctrl+Y)"><Redo className="w-4 h-4" /></button>
        <div className="w-px h-6 bg-gray-300 self-center mx-0.5" />
        <div className="flex items-center text-xs font-medium text-gray-500 bg-gray-50 rounded border border-gray-200 overflow-hidden">
          <button onClick={() => handleTableAction("addCol")} className="p-1.5 px-2 hover:bg-gray-200 hover:text-gray-800" title="Tambah Kolom">+Col</button>
          <div className="w-px h-4 bg-gray-300" />
          <button onClick={() => handleTableAction("addRow")} className="p-1.5 px-2 hover:bg-gray-200 hover:text-gray-800" title="Tambah Baris">+Row</button>
          <div className="w-px h-4 bg-gray-300" />
          <button onClick={() => handleTableAction("delCol")} className="p-1.5 px-2 hover:bg-red-100 text-red-600" title="Hapus Kolom">-Col</button>
          <div className="w-px h-4 bg-gray-300" />
          <button onClick={() => handleTableAction("delRow")} className="p-1.5 px-2 hover:bg-red-100 text-red-600" title="Hapus Baris">-Row</button>
          <div className="w-px h-4 bg-gray-300" />
          <button onClick={() => handleTableAction("delTable")} className="p-1.5 px-2 hover:bg-red-100 text-red-600" title="Hapus Tabel">Del</button>
        </div>
        <div className="w-px h-6 bg-gray-300 self-center mx-0.5" />
        <div className="w-px h-6 bg-gray-300 self-center mx-0.5" />
        <div ref={menuRef} className="relative flex">
          <button onClick={handleFlatten} disabled={aiTask !== null} className="flex items-center gap-1.5 p-2 px-3 rounded-l text-white bg-emerald-600 hover:bg-emerald-700 font-medium text-sm disabled:opacity-60 disabled:cursor-wait" title="Rapikan format dokumen tanpa AI: tampilan dipertahankan, Tailwind/class dibuang (Word export ikut rapi). Tabel semu bisa diubah jadi tabel asli dengan AI setelahnya.">
            <FileCheck2 className="w-4 h-4" /><span>{aiTask ? aiTask.label : "Rapikan Dokumen"}</span>
          </button>
          <button onClick={() => setMenuOpen((o) => !o)} disabled={aiTask !== null} aria-label="Pilihan rapikan lainnya" aria-expanded={menuOpen} className="px-1.5 rounded-r text-white bg-emerald-600 hover:bg-emerald-700 border-l border-emerald-500 disabled:opacity-60">
            <ChevronDown className="w-4 h-4" />
          </button>
          {menuOpen && (
            <div className="absolute left-0 top-full mt-1 z-30 w-80 bg-white border border-gray-200 rounded-md shadow-lg py-1 text-sm">
              <MenuItem icon={<Sparkles className="w-4 h-4" />} title="Rapikan dengan AI" hint="Seluruh dokumen: kotak grid/flex jadi tabel asli. Ada pratinjau & cek isi." onClick={handleAiRestructure} />
              <MenuItem icon={<Table2 className="w-4 h-4" />} title="Rapikan tabel ini dengan AI" hint="Klik dulu di dalam tabel yang ingin dirapikan." onClick={handleAiFixTable} />
              <MenuItem icon={<Scissors className="w-4 h-4" />} title="Sisipkan batas halaman" hint="Paksa pindah halaman di posisi kursor (batas otomatis sudah ada)." onClick={() => { setMenuOpen(false); handleInsertPageBreak(); }} />
            </div>
          )}
        </div>
        {plan.previousVersion && (
          <button onClick={handleRestoreVersion} disabled={aiTask !== null} className="flex items-center gap-1.5 p-2 px-3 rounded hover:bg-amber-100 text-amber-700 font-medium text-sm border border-amber-200" title={`Kembalikan versi sebelum ${plan.previousVersion.reason}`}>
            <RotateCcw className="w-4 h-4" /><span>Kembalikan</span>
          </button>
        )}
        <div className="w-px h-6 bg-gray-300 self-center mx-0.5" />
        <button onClick={handleMagicPaste} className="flex items-center gap-1.5 p-2 px-3 rounded hover:bg-purple-100 text-purple-700 font-medium text-sm" title="Paste HTML dari clipboard">
          <Wand2 className="w-4 h-4" /><span>Magic Paste</span>
        </button>
        <CopyPromptButton className="flex items-center gap-1.5 p-2 px-3 rounded hover:bg-purple-100 text-purple-700 font-medium text-sm border border-purple-200" />
      </div>

      <div id="editor-scroll-container" className="w-full bg-[#e5e7eb] overflow-y-auto pb-20 pt-4 flex-1">
        <div className="relative mx-auto bg-white shadow-lg flex flex-col" style={{ ...paperStyle, padding: 0 }} id="print-content">
          <iframe key={frameKey} ref={iframeRef} style={{ width: "100%", flex: "1 1 auto", border: "none", display: "block", minHeight: paperStyle.minHeight }} title="Editor" />
          {/* Overlay outside the document: never saved or printed */}
          {pageLayout.sheets.map((sheet, i) => {
            const last = i === pageLayout.sheets.length - 1;
            return (
              <React.Fragment key={i}>
                <span className="absolute right-3 text-[10px] font-medium text-gray-400 pointer-events-none" style={{ top: sheet.top + 8 }}>
                  Halaman {i + 1}
                </span>
                {sheet.empty && (
                  <div className="absolute left-0 right-0 text-center pointer-events-none" style={{ top: sheet.top + sheetHeightPx(paperSize) / 2 - 24 }}>
                    <div className="text-sm font-semibold text-gray-400">Halaman kosong</div>
                    <div className="text-xs text-gray-400">Hapus baris kosong, atau tekan Backspace di awal halaman berikutnya untuk menghapus batas halaman</div>
                  </div>
                )}
                {!last && sheet.gapAfter && (
                  <>
                    {/* Page margins stay blank, like paper: hides spacer rows and the borders of a
                        table or box that continues on the next sheet (no text is ever placed here) */}
                    <div className="absolute left-0 right-0 pointer-events-none bg-white"
                      style={{ top: sheet.blankFrom, height: pageLayout.sheets[i + 1].contentTop - sheet.blankFrom }} />
                    <div
                      className="absolute -left-2 -right-2 pointer-events-none bg-[#e5e7eb]"
                      style={{ top: sheet.top + sheetHeightPx(paperSize), height: SHEET_GAP_PX,
                        boxShadow: "inset 0 7px 6px -6px rgba(0,0,0,.25), inset 0 -7px 6px -6px rgba(0,0,0,.25)" }}
                    />
                  </>
                )}
                {!last && !sheet.gapAfter && (
                  <div className="absolute left-0 right-0 pointer-events-none border-t-2 border-dashed border-sky-400" style={{ top: sheet.contentBottom }}>
                    <span className="absolute right-2 -top-3 text-[10px] font-medium text-sky-700 bg-sky-50 border border-sky-200 rounded px-1.5">
                      Halaman {i + 2} (bagian ini terlalu tinggi untuk dipindah utuh)
                    </span>
                  </div>
                )}
              </React.Fragment>
            );
          })}
          {pageLayout.guides.map((top, i) => (
            <div key={i} className="absolute left-0 right-0 pointer-events-none border-t-2 border-dashed border-sky-400" style={{ top }}>
              <span className="absolute right-2 -top-3 text-[10px] font-medium text-sky-700 bg-sky-50 border border-sky-200 rounded px-1.5">
                Halaman {i + 2}
              </span>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-center gap-3 text-xs text-gray-500 mt-3">
          <span>
            {sheetView ? pageLayout.sheets.length : pageLayout.guides.length + 1} halaman saat dicetak
            {sheetView ? " — Ctrl+Enter untuk pindah halaman" : " — garis biru = batas halaman otomatis"}
          </span>
          <span className="inline-flex rounded border border-gray-300 overflow-hidden">
            <button onClick={() => setSheetView(true)} className={`px-2 py-0.5 ${sheetView ? "bg-gray-700 text-white" : "bg-white hover:bg-gray-100"}`}>Per halaman</button>
            <button onClick={() => setSheetView(false)} className={`px-2 py-0.5 ${!sheetView ? "bg-gray-700 text-white" : "bg-white hover:bg-gray-100"}`}>Menerus</button>
          </span>
        </div>
      </div>
      {preview && (
        <RestructurePreview
          beforeHtml={preview.before}
          afterHtml={preview.after}
          result={preview.result}
          onApply={handleApplyRestructure}
          onCancel={() => setPreview(null)}
        />
      )}
    </div>
  );
};
