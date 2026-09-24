import React, { useEffect, useRef, useCallback, useState } from "react";
import { useStore } from "../store";
import { sanitizeFragment } from "../sanitize";
import { stripPrintChrome, stripRenderedChrome } from "../cleanup";
import { serializeDoc, prepareForEditor, writeToIframe, onceParsed } from "../editorDocument";
import { callGemini, getGeminiKey, describeGeminiError } from "../gemini";
import { restructureDocument, type RestructureResult } from "../restructure";
import { RestructurePreview } from "./RestructurePreview";
import { buildGrid, freezeColumnWidths, insertColumnAfter, insertRowAfter, deleteColumns, deleteRows } from "../tableOps";
import { CopyPromptButton } from "./CopyPromptButton";
import {
  Bold, Italic, Underline as UnderlineIcon, List, ListOrdered,
  Undo, Redo, Wand2, Scissors, Sparkles, FileCheck2, RotateCcw
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
    user-select: none !important;
    pointer-events: none !important;
    position: static !important;
  }
  .page-break::before {
    content: "✂ BATAS HALAMAN — teks setelah ini pindah ke halaman baru saat Print/PDF";
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
    if (!target || (target.tagName !== "TD" && target.tagName !== "TH")) {
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

export const IframeEditor: React.FC<IframeEditorProps> = ({ planId }) => {
  const { plans, updatePlan, replaceContent, restorePreviousVersion, paperSize } = useStore();
  const plan = plans.find((p) => p.id === planId);
  // One AI task at a time; the label shows progress on the button that started it
  const [aiTask, setAiTask] = useState<{ kind: "table" | "doc"; label: string } | null>(null);
  const [preview, setPreview] = useState<{ before: string; after: string; result: RestructureResult } | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const adjustHeight = useCallback((forceReset = false) => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const doc = iframe.contentDocument;
    if (!doc || !doc.body) return;
    const scrollContainer = document.getElementById("editor-scroll-container");
    const savedScroll = scrollContainer?.scrollTop ?? 0;
    if (forceReset) iframe.style.height = "10px";
    const newH = Math.max(doc.body.scrollHeight, doc.documentElement.scrollHeight, 300);
    const currentH = parseInt(iframe.style.height || "0", 10);
    if (forceReset || newH + 60 > currentH) iframe.style.height = `${newH + 60}px`;
    if (scrollContainer && savedScroll > 0) scrollContainer.scrollTop = savedScroll;
  }, []);

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

    const oldObserver = (doc as any)._heightObserver;
    if (oldObserver) oldObserver.disconnect();
    const observer = new MutationObserver(() => adjustHeight());
    observer.observe(doc.body, { childList: true, subtree: true, characterData: true, attributes: true });
    (doc as any)._heightObserver = observer;

    // Print toolbars only detectable once rendered; run again after the Tailwind CDN,
    // which generates its styles after DOMContentLoaded, has styled the page.
    const cleanRendered = () => {
      if (stripRenderedChrome(doc) > 0) updatePlan(planId, serializeDoc(doc));
    };
    cleanRendered();
    const cleanTimer = setTimeout(cleanRendered, 1500);

    setTimeout(() => adjustHeight(true), 150);
    setTimeout(() => adjustHeight(), 800);
    setTimeout(() => adjustHeight(), 2500);

    return () => {
      doc.removeEventListener("input", newHandler);
      observer.disconnect();
      clearTimeout(cleanTimer);
    };
  }, [planId, updatePlan, adjustHeight]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !plan) return;
    const doc = iframe.contentDocument;
    if (!doc) return;
    if (doc.body && doc.body.innerHTML.trim().length > 0) return;

    writeToIframe(iframe, prepareForEditor(plan.content || ""));
    let cancelled = false;
    let cleanup: (() => void) | undefined;
    onceParsed(doc, () => {
      if (!cancelled) cleanup = setupIframe(doc);
    });
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [planId]); // eslint-disable-line react-hooks/exhaustive-deps

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
    return node && (node.nodeName === "TD" || node.nodeName === "TH") ? (node as HTMLTableCellElement) : null;
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
  const loadIntoEditor = (html: string, reason?: string) => {
    const iframe = iframeRef.current;
    const doc = iframe?.contentDocument;
    if (!iframe || !doc) return;
    writeToIframe(iframe, prepareForEditor(html));
    // doc.open() erases every event listener, so the table resizer must be re-attached
    (doc as any)._tableResizerAttached = false;
    onceParsed(doc, () => {
      // Store before setupIframe: its print-toolbar cleanup may save again right away
      if (reason) replaceContent(planId, serializeDoc(doc), reason);
      setupIframe(doc);
    });
  };

  const handleRestoreVersion = () => {
    const reason = plan?.previousVersion?.reason;
    if (!window.confirm(`Kembalikan dokumen ke versi sebelum "${reason}"?\nPerubahan sejak itu akan hilang.`)) return;
    const previous = restorePreviousVersion(planId);
    if (previous !== null) loadIntoEditor(previous);
  };

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
    const doc = iframeRef.current?.contentDocument;
    if (!doc?.body || !plan) return;
    const apiKey = getGeminiKey();
    if (!apiKey) return;
    setAiTask({ kind: "doc", label: "Menyiapkan..." });
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
        <button onClick={handleInsertPageBreak} className="flex items-center gap-1.5 p-2 px-3 rounded hover:bg-orange-100 text-orange-700 font-medium text-sm" title="Batas Halaman">
          <Scissors className="w-4 h-4" /><span>Batas Halaman</span>
        </button>
        <div className="w-px h-6 bg-gray-300 self-center mx-0.5" />
        <button onClick={handleAiRestructure} disabled={aiTask !== null} className="flex items-center gap-1.5 p-2 px-3 rounded text-white bg-emerald-600 hover:bg-emerald-700 font-medium text-sm disabled:opacity-60 disabled:cursor-wait" title="Rapikan format seluruh dokumen dengan AI Gemini (tabel asli, tanpa Tailwind, siap cetak). Isi teks diperiksa otomatis dan ada pratinjau sebelum diterapkan.">
          <FileCheck2 className="w-4 h-4" /><span>{aiTask?.kind === "doc" ? aiTask.label : "Rapikan Dokumen (AI)"}</span>
        </button>
        <button id="ai-fix-btn" onClick={handleAiFixTable} disabled={aiTask !== null} className="flex items-center gap-1.5 p-2 px-3 rounded hover:bg-emerald-100 text-emerald-700 font-medium text-sm border border-emerald-200 disabled:opacity-60 disabled:cursor-wait" title="Rapikan satu tabel (yang sedang diklik) dengan AI Gemini">
          <Sparkles className="w-4 h-4" /><span>{aiTask?.kind === "table" ? aiTask.label : "Rapikan Tabel (AI)"}</span>
        </button>
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
        <div className="mx-auto bg-white shadow-lg flex flex-col" style={{ ...paperStyle, padding: 0 }} id="print-content">
          <iframe ref={iframeRef} style={{ width: "100%", flex: "1 1 auto", border: "none", display: "block", minHeight: paperStyle.minHeight }} title="Editor" />
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
