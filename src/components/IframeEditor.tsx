import React, { useEffect, useRef, useCallback } from "react";
import { useStore } from "../store";
import { sanitizeDocument, sanitizeFragment, EDITOR_CSP } from "../sanitize";
import {
  Bold, Italic, Underline as UnderlineIcon, List, ListOrdered,
  Undo, Redo, Wand2, Scissors, Sparkles
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

// Editor-only CSS (#agy-style) and resize cursors must never reach the stored document:
// otherwise exports carry editor visuals and old documents never pick up CSS fixes.
function serializeDoc(doc: Document): string {
  const root = doc.documentElement.cloneNode(true) as HTMLElement;
  root.querySelectorAll("#agy-style, #agy-csp").forEach((el) => el.remove());
  root.querySelectorAll<HTMLElement>("td, th").forEach((cell) => {
    if (!cell.style.cursor) return;
    cell.style.cursor = "";
    if (!cell.getAttribute("style")) cell.removeAttribute("style");
  });
  return root.outerHTML;
}

const DEFAULT_TEMPLATE = (body: string) => `<html><head>
  <meta charset="utf-8">
  <script id="MathJax-script" async src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js"></script>
  <style>body { font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif; padding: 20px; line-height: 1.5; } table { border-collapse: collapse; width: 100%; } table, th, td { border: 1px solid #ccc; padding: 8px; }</style>
  </head><body>${body}</body></html>`;

// Turn stored/pasted HTML into a safe full document for the iframe: wrap fragments in the
// default template, strip AI print bars (.no-print) and editor-only elements saved by older
// versions, sanitize, and put the CSP first in <head> so it covers everything after it.
function prepareForEditor(html: string): string {
  const source = html.toLowerCase().includes("<html") ? html : DEFAULT_TEMPLATE(html);
  const parsed = sanitizeDocument(source);
  parsed.querySelectorAll(".no-print, #agy-style, #agy-csp").forEach((el) => el.remove());
  const csp = parsed.createElement("meta");
  csp.id = "agy-csp";
  csp.httpEquiv = "Content-Security-Policy";
  csp.content = EDITOR_CSP;
  parsed.head.prepend(csp);
  return parsed.documentElement.outerHTML;
}

function writeToIframe(iframe: HTMLIFrameElement, html: string) {
  const doc = iframe.contentDocument!;
  doc.open();
  // MathJax reads its config from window.MathJax. Set it from here, because inline
  // <script> config is stripped by the sanitizer and blocked by the CSP.
  (iframe.contentWindow as any).MathJax = { tex: { inlineMath: [["$", "$"], ["\\(", "\\)"]] } };
  doc.write(html);
  doc.close();
}

// A blocking <script src> in <head> (e.g. the Tailwind CDN) pauses the parser, so right
// after doc.close() the document may not have a <body> yet.
function onceParsed(doc: Document, fn: () => void) {
  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", fn, { once: true });
  else fn();
}

async function callGemini(apiKey: string, prompt: string): Promise<string> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-latest:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2 },
      }),
    }
  );
  if (!response.ok) {
    const err = await response.json();
    throw new Error(err?.error?.message || `HTTP ${response.status}`);
  }
  const data = await response.json();
  const text: string = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  return text.replace(/^```html\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/g, "").trim();
}

function attachTableResizer(doc: Document) {
  let isResizingCol = false;
  let isResizingRow = false;
  let currentCell: HTMLElement | null = null;
  let resizeMode: "col" | "row" | null = null;
  let startX = 0;
  let startY = 0;

  function getCols(table: HTMLTableElement): HTMLElement[] {
    let colgroup = table.querySelector("colgroup");
    if (!colgroup) {
      colgroup = doc.createElement("colgroup");
      let maxCols = 0;
      let templateRow: HTMLTableRowElement | null = null;
      for (let i = 0; i < table.rows.length; i++) {
        let cols = 0;
        for (let j = 0; j < table.rows[i].cells.length; j++) {
          cols += table.rows[i].cells[j].colSpan || 1;
        }
        if (cols > maxCols) { maxCols = cols; templateRow = table.rows[i]; }
      }
      for (let i = 0; i < maxCols; i++) colgroup.appendChild(doc.createElement("col"));
      if (templateRow) {
        let colIdx = 0;
        for (let i = 0; i < templateRow.cells.length; i++) {
          const c = templateRow.cells[i];
          const span = c.colSpan || 1;
          const w = parseInt(doc.defaultView?.getComputedStyle(c).width || "0", 10) / span;
          for (let s = 0; s < span; s++) {
            const col = colgroup.children[colIdx] as HTMLElement;
            if (col) col.style.width = w + "px";
            colIdx++;
          }
        }
      }
      table.insertBefore(colgroup, table.firstChild);
    }
    return Array.from(colgroup.querySelectorAll("col")) as HTMLElement[];
  }

  doc.addEventListener("mousemove", (e) => {
    if (isResizingCol) {
      const state = (doc as any)._resizeCols;
      if (!state) return;
      const dx = e.clientX - startX;
      if (state.leftCol) state.leftCol.style.width = `${Math.max(20, state.startWidth + dx)}px`;
      if (state.rightCol) state.rightCol.style.width = `${Math.max(20, state.startNextWidth - dx)}px`;
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
      const cols = getCols(table);
      const row = currentCell.parentElement as HTMLTableRowElement;
      let colIndex = 0;
      for (let i = 0; i < row.cells.length; i++) {
        if (row.cells[i] === currentCell) break;
        colIndex += row.cells[i].colSpan || 1;
      }
      const span = (currentCell as HTMLTableCellElement).colSpan || 1;
      const leftColIdx = colIndex + span - 1;
      const rightColIdx = leftColIdx + 1;
      const leftCol = cols[leftColIdx] as HTMLElement | undefined;
      const rightCol = cols[rightColIdx] as HTMLElement | undefined;
      if (!leftCol) return;
      isResizingCol = true;
      startX = e.clientX;
      const getW = (col: HTMLElement) =>
        parseInt(col.style.width || doc.defaultView?.getComputedStyle(col).width || "0", 10);
      (doc as any)._resizeCols = { leftCol, rightCol, startWidth: getW(leftCol), startNextWidth: rightCol ? getW(rightCol) : 0 };
      table.style.tableLayout = "fixed";
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
  const { plans, updatePlan, paperSize } = useStore();
  const plan = plans.find((p) => p.id === planId);
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

    setTimeout(() => adjustHeight(true), 150);
    setTimeout(() => adjustHeight(), 800);
    setTimeout(() => adjustHeight(), 2500);

    return () => {
      doc.removeEventListener("input", newHandler);
      observer.disconnect();
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
    const row = cell.parentNode as HTMLTableRowElement;
    const table = cell.closest("table") as HTMLTableElement;
    const cellIndex = Array.prototype.indexOf.call(row.children, cell);
    switch (action) {
      case "addRow": {
        const newRow = row.cloneNode(true) as HTMLTableRowElement;
        Array.from(newRow.cells).forEach(c => (c.innerHTML = ""));
        row.parentNode?.insertBefore(newRow, row.nextSibling); break;
      }
      case "delRow": row.parentNode?.removeChild(row); break;
      case "addCol":
        Array.from(table.rows).forEach(r => {
          const nc = r.cells[cellIndex]?.cloneNode(true) as HTMLTableCellElement;
          if (!nc) return; nc.innerHTML = "";
          r.insertBefore(nc, r.cells[cellIndex].nextSibling);
        }); break;
      case "delCol":
        Array.from(table.rows).forEach(r => { if (r.cells[cellIndex]) r.removeChild(r.cells[cellIndex]); }); break;
      case "delTable": table.parentNode?.removeChild(table); break;
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

  const handleMagicPaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      const cleaned = text.replace(/```html\s*/gi, "").replace(/```\s*/g, "").trim();
      const iframe = iframeRef.current;
      const doc = iframe?.contentDocument;
      if (!iframe || !doc) return;
      if (cleaned.toLowerCase().includes("<html")) {
        writeToIframe(iframe, prepareForEditor(cleaned));
        // doc.open() erases every event listener, so the table resizer must be re-attached
        (doc as any)._tableResizerAttached = false;
        onceParsed(doc, () => {
          setupIframe(doc);
          updatePlan(planId, serializeDoc(doc));
        });
      } else {
        exec("insertHTML", sanitizeFragment(cleaned));
      }
    } catch {
      alert("Gagal membaca clipboard. Pastikan izin clipboard sudah diberikan.");
    }
  };

  const handleAiFixTable = async () => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc) return;
    let apiKey = localStorage.getItem("gemini_api_key") || "";
    if (!apiKey) {
      apiKey = prompt(
        "Masukkan Gemini API Key Anda:\n(Dapatkan gratis di https://aistudio.google.com/apikey)\n\nKey ini disimpan hanya di browser Anda, tidak dikirim ke server manapun selain Google."
      ) || "";
      if (!apiKey) return;
      localStorage.setItem("gemini_api_key", apiKey.trim());
    }
    const cell = getSelectedCell();
    const targetTable: HTMLTableElement | null = cell
      ? (cell.closest("table") as HTMLTableElement)
      : (doc.querySelector("table") as HTMLTableElement | null);
    if (!targetTable) {
      alert("Tidak ada tabel yang ditemukan. Klik di dalam tabel terlebih dahulu."); return;
    }
    const btn = document.getElementById("ai-fix-btn") as HTMLButtonElement | null;
    if (btn) { btn.textContent = "Memproses..."; btn.disabled = true; }
    try {
      const prompt = `Kamu adalah asisten perapih tabel HTML untuk RPP (Rencana Pelaksanaan Pembelajaran).
Perbaiki tabel HTML di bawah ini agar:
1. Setiap kolom proporsional menggunakan width di <col> atau style inline
2. Tidak ada konten yang terpotong
3. Baris header tetap terbaca jelas
4. Gunakan style inline saja (tidak pakai class Tailwind)
5. Kembalikan HANYA kode HTML tabel saja (mulai <table> hingga </table>), tanpa penjelasan.

${targetTable.outerHTML}`;
      const fixedHtml = await callGemini(apiKey.trim(), prompt);
      if (!fixedHtml.toLowerCase().includes("<table")) throw new Error("AI tidak mengembalikan tabel HTML yang valid.");
      const tmp = doc.createElement("div");
      tmp.innerHTML = sanitizeFragment(fixedHtml);
      const newTable = tmp.querySelector("table");
      if (newTable) {
        targetTable.replaceWith(newTable);
        doc.dispatchEvent(new Event("input", { bubbles: true }));
        adjustHeight();
      }
    } catch (err: any) {
      if (err.message?.includes("API_KEY_INVALID") || err.message?.includes("401")) {
        localStorage.removeItem("gemini_api_key");
        alert("API Key tidak valid atau kadaluarsa. Silakan coba lagi.");
      } else {
        alert(`Gagal: ${err.message}`);
      }
    } finally {
      if (btn) { btn.textContent = "✨ Rapikan Tabel (AI)"; btn.disabled = false; }
    }
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
        <button id="ai-fix-btn" onClick={handleAiFixTable} className="flex items-center gap-1.5 p-2 px-3 rounded hover:bg-emerald-100 text-emerald-700 font-medium text-sm border border-emerald-200" title="Rapikan tabel menggunakan AI Gemini">
          <Sparkles className="w-4 h-4" /><span>Rapikan Tabel (AI)</span>
        </button>
        <div className="w-px h-6 bg-gray-300 self-center mx-0.5" />
        <button onClick={handleMagicPaste} className="flex items-center gap-1.5 p-2 px-3 rounded hover:bg-purple-100 text-purple-700 font-medium text-sm" title="Paste HTML dari clipboard">
          <Wand2 className="w-4 h-4" /><span>Magic Paste</span>
        </button>
      </div>

      <div id="editor-scroll-container" className="w-full bg-[#e5e7eb] overflow-y-auto pb-20 pt-4 flex-1">
        <div className="mx-auto bg-white shadow-lg flex flex-col" style={{ ...paperStyle, padding: 0 }} id="print-content">
          <iframe ref={iframeRef} style={{ width: "100%", flex: "1 1 auto", border: "none", display: "block", minHeight: paperStyle.minHeight }} title="Editor" />
        </div>
      </div>
    </div>
  );
};
