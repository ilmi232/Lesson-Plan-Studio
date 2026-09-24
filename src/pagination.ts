import { buildGrid } from "./tableOps";

// Printing through the browser (real text, MathJax, @page size and margins) and the page
// guides shown in the editor, which simulate the same break rules the print CSS applies.

export const PRINT_MARGIN_MM = 15;
const PX_PER_MM = 96 / 25.4;

export const PAPER_MM: Record<string, [number, number]> = {
  a4: [210, 297],
  f4: [215.9, 330.2],
  letter: [215.9, 279.4],
  legal: [215.9, 355.6],
};

const paperMm = (paperSize: string) => PAPER_MM[paperSize] ?? PAPER_MM.a4;

// Printable height of one page in CSS px
export function pageContentHeightPx(paperSize: string): number {
  return (paperMm(paperSize)[1] - 2 * PRINT_MARGIN_MM) * PX_PER_MM;
}

const KEEP_TAGS = new Set(["TR", "IMG", "FIGURE", "LI", "BLOCKQUOTE", "PRE"]);
const BOX_TAGS = new Set(["DIV", "SECTION", "ARTICLE", "ASIDE", "HEADER", "FOOTER"]);

function looksLikeBox(cs: CSSStyleDeclaration): boolean {
  const background = cs.backgroundColor !== "rgba(0, 0, 0, 0)" && cs.backgroundColor !== "transparent";
  const border = ["Top", "Right", "Bottom", "Left"].some(
    (side) => parseFloat(cs.getPropertyValue(`border-${side.toLowerCase()}-width`)) > 0 &&
              cs.getPropertyValue(`border-${side.toLowerCase()}-style`) !== "none"
  );
  return background || border;
}

// Blocks that should not be split across pages: table rows, images, list items, small tables,
// and colored/bordered boxes (the "cards" of AI worksheets) — only when they fit on one page,
// otherwise they have to be split anyway. Nested blocks inside a kept block are left out.
export function findKeepBlocks(doc: Document, pageHeight: number): HTMLElement[] {
  const win = doc.defaultView;
  if (!win || !doc.body) return [];
  const blocks: HTMLElement[] = [];
  for (const el of Array.from(doc.body.querySelectorAll<HTMLElement>("*"))) {
    if (el.tagName.includes("-") || el.closest("svg, math, .page-break, [data-agy-gap]")) continue;
    const height = el.getBoundingClientRect().height;
    if (height <= 0 || height > pageHeight * 0.9) continue;
    const keep = KEEP_TAGS.has(el.tagName) ||
      (el.tagName === "TABLE" && height <= pageHeight * 0.5) ||
      (BOX_TAGS.has(el.tagName) && looksLikeBox(win.getComputedStyle(el)));
    if (keep && !blocks.some((b) => b.contains(el))) blocks.push(el);
  }
  return blocks;
}

interface Item { top: number; bottom: number; kind: "keep" | "heading" | "break" }

// Where each new page starts, in document coordinates (px from the top of the iframe
// document). Mirrors the print CSS: manual page breaks, keep blocks moved whole to the next
// page, headings not left alone at the bottom of a page.
export function computePageStarts(doc: Document, paperSize: string): number[] {
  const win = doc.defaultView;
  if (!win || !doc.body) return [];
  const pageHeight = pageContentHeightPx(paperSize);
  const y = (el: Element) => {
    const r = el.getBoundingClientRect();
    return { top: r.top + win.scrollY, bottom: r.bottom + win.scrollY };
  };
  const items: Item[] = [
    ...findKeepBlocks(doc, pageHeight).map((el) => ({ ...y(el), kind: "keep" as const })),
    ...Array.from(doc.body.querySelectorAll("h1, h2, h3, h4")).map((el) => ({ ...y(el), kind: "heading" as const })),
    ...Array.from(doc.body.querySelectorAll(".page-break")).map((el) => ({ ...y(el), kind: "break" as const })),
  ].sort((a, b) => a.top - b.top);

  const range = doc.createRange();
  range.selectNodeContents(doc.body);
  const contentBottom = range.getBoundingClientRect().bottom + win.scrollY;
  let pageTop = parseFloat(win.getComputedStyle(doc.documentElement).paddingTop) || 0;
  const starts: number[] = [];

  for (const item of items) {
    while (item.top >= pageTop + pageHeight) {
      pageTop += pageHeight;
      starts.push(pageTop);
    }
    if (item.kind === "break") {
      pageTop = item.bottom;
      starts.push(pageTop);
      continue;
    }
    // A heading needs at least a line of what follows on the same page
    const needed = item.kind === "heading" ? item.bottom + 40 : item.bottom;
    if (needed > pageTop + pageHeight && item.top > pageTop + 1 && item.bottom - item.top <= pageHeight) {
      pageTop = item.top;
      starts.push(pageTop);
    }
  }
  while (contentBottom > pageTop + pageHeight + 1) {
    pageTop += pageHeight;
    starts.push(pageTop);
  }
  return starts;
}

// ---------------------------------------------------------------------------------------------
// Sheet view: the editor shows separate paper sheets like Word. Editor-only spacers
// (data-agy-gap) push content to the top of the next sheet; the grey gap between sheets is an
// overlay drawn by the editor. Spacers are never saved, exported or printed; printing forces a
// page break at the same elements, so paper matches the screen.

export const SHEET_GAP_PX = 28;

export function sheetHeightPx(paperSize: string): number {
  return paperMm(paperSize)[1] * PX_PER_MM;
}
const GAP_ATTR = "data-agy-gap";
const BREAK_ATTR = "data-agy-break";

export function removeSheetGaps(doc: Document) {
  doc.querySelectorAll(`[${GAP_ATTR}]`).forEach((el) => el.remove());
}

export interface Sheet {
  top: number;       // top edge of the sheet (document px)
  contentTop: number;
  contentBottom: number;
  gapAfter: boolean; // false: the next page could not be moved to a new sheet (dashed guide)
  blankFrom: number; // where the blank page bottom starts (a table split between rows ends at its last row)
  empty: boolean;
}

export interface SheetLayout {
  sheets: Sheet[];
  breakEls: HTMLElement[]; // elements that start a new sheet (forced page breaks when printing)
  totalHeight: number;
}

const isGap = (el: Element) => el.hasAttribute(GAP_ATTR);

function flowChildren(el: HTMLElement): HTMLElement[] {
  const kids = el.tagName === "TABLE"
    ? Array.from((el as HTMLTableElement).rows)
    : (Array.from(el.children) as HTMLElement[]);
  return kids.filter((k) => !isGap(k) && !/^(SCRIPT|STYLE|COLGROUP|COL|CAPTION)$/.test(k.tagName));
}

function isKeep(el: HTMLElement, cs: CSSStyleDeclaration, height: number, pageHeight: number): boolean {
  if (height > pageHeight * 0.9) return false;
  return KEEP_TAGS.has(el.tagName) || (el.tagName === "TABLE" && height <= pageHeight * 0.5) ||
    (BOX_TAGS.has(el.tagName) && looksLikeBox(cs));
}

// The element that has to start the next sheet when the page ends at y, or null when the
// content crossing y cannot be moved (taller than a page, or a flex/grid block).
function breakTarget(container: HTMLElement, y: number, pageTop: number, pageHeight: number): HTMLElement | null {
  const win = container.ownerDocument.defaultView!;
  for (const child of flowChildren(container)) {
    const r = child.getBoundingClientRect();
    if (r.height === 0 || r.bottom + win.scrollY <= y) continue;
    const top = r.top + win.scrollY;
    if (top >= y - 0.5) return child; // starts on the next page already
    const cs = win.getComputedStyle(child);
    if (isKeep(child, cs, r.height, pageHeight) && top > pageTop + 1) return child;
    if (child.tagName === "TABLE") {
      const row = breakTarget(child, y, pageTop, pageHeight);
      // Never leave just the header row behind: move the whole table instead
      const rows = flowChildren(child);
      if (row && row !== rows[0] && row.parentElement?.tagName !== "THEAD") return row;
      return top > pageTop + 1 && r.height <= pageHeight ? child : null;
    }
    const flow = /^(block|flow-root|list-item)$/.test(cs.display) || child.tagName === "UL" || child.tagName === "OL";
    if (flow && child.children.length) {
      const inner = breakTarget(child, y, pageTop, pageHeight);
      if (inner) return inner;
    }
    // A paragraph (or unsplittable block) crossing the line moves as a whole when it fits
    return top > pageTop + 1 && r.height <= pageHeight ? child : null;
  }
  return null;
}

// The next element in document flow after el (for a manual page break)
function flowNext(el: Element, body: HTMLElement): HTMLElement | null {
  let node: Element | null = el;
  while (node && node !== body) {
    let next = node.nextElementSibling;
    while (next && isGap(next)) next = next.nextElementSibling;
    if (next) return next as HTMLElement;
    node = node.parentElement;
  }
  return null;
}

function insertGap(doc: Document, before: HTMLElement, height: number): HTMLElement {
  let gap: HTMLElement;
  if (before.tagName === "TR") {
    gap = doc.createElement("tr");
    const td = doc.createElement("td");
    // Exactly the table's width: a larger colspan would add phantom columns
    const table = before.closest("table");
    td.colSpan = table ? Math.max(1, buildGrid(table).width) : 1;
    td.style.cssText = "padding:0;border:0";
    gap.appendChild(td);
  } else {
    gap = doc.createElement(before.tagName === "LI" ? "li" : "div");
    gap.style.listStyle = "none";
  }
  gap.setAttribute(GAP_ATTR, "");
  gap.setAttribute("contenteditable", "false");
  gap.style.margin = "0";
  gap.style.padding = "0";
  gap.style.border = "0";
  gap.style.height = `${Math.max(0, height)}px`;
  before.before(gap);
  return gap;
}

const MEDIA = "img, svg, canvas, video, table, hr, mjx-container, math";

// Sheets with nothing on them (e.g. two manual page breaks in a row, or trailing empty lines)
function markEmptySheets(doc: Document, sheets: Sheet[]) {
  const win = doc.defaultView!;
  const used = new Set<number>();
  const mark = (top: number, bottom: number) => sheets.forEach((s, i) => {
    if (bottom > s.contentTop && top < s.contentBottom + 1) used.add(i);
  });
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const range = doc.createRange();
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (!node.nodeValue?.trim() || node.parentElement?.closest(".page-break, script, style, [data-agy-gap]")) continue;
    range.selectNodeContents(node);
    const r = range.getBoundingClientRect();
    mark(r.top + win.scrollY, r.bottom + win.scrollY);
  }
  doc.body.querySelectorAll<HTMLElement>(`${MEDIA}, div, span, td, th`).forEach((el) => {
    if (isGap(el) || el.closest(".page-break")) return;
    if (!el.matches(MEDIA) && !looksLikeBox(win.getComputedStyle(el))) return;
    const r = el.getBoundingClientRect();
    if (r.height > 0) mark(r.top + win.scrollY, r.bottom + win.scrollY);
  });
  sheets.forEach((s, i) => (s.empty = !used.has(i)));
}

export function layoutSheets(doc: Document, paperSize: string): SheetLayout {
  removeSheetGaps(doc);
  const win = doc.defaultView;
  if (!win || !doc.body) return { sheets: [], breakEls: [], totalHeight: 0 };
  const paperHeight = paperMm(paperSize)[1] * PX_PER_MM;
  const margin = PRINT_MARGIN_MM * PX_PER_MM;
  const pageHeight = paperHeight - 2 * margin;
  const top = (el: Element) => el.getBoundingClientRect().top + win.scrollY;
  const contentBottom = () => {
    const range = doc.createRange();
    range.selectNodeContents(doc.body);
    return range.getBoundingClientRect().bottom + win.scrollY;
  };

  const sheets: Sheet[] = [];
  const breakEls: HTMLElement[] = [];
  let sheetTop = 0;
  let pageTop = margin;
  for (let guard = 0; guard < 400; guard++) {
    const pageBottom = pageTop + pageHeight;
    const sheet: Sheet = { top: sheetTop, contentTop: pageTop, contentBottom: pageBottom, gapAfter: true, empty: false, blankFrom: pageBottom };
    sheets.push(sheet);

    const forced = Array.from(doc.querySelectorAll<HTMLElement>(".page-break"))
      .find((pb) => top(pb) >= pageTop - 1 && top(pb) < pageBottom);
    let target: HTMLElement | null;
    if (forced) {
      target = flowNext(forced, doc.body);
      if (!target) break;
    } else {
      if (contentBottom() <= pageBottom + 1) break;
      target = breakTarget(doc.body, pageBottom, pageTop, pageHeight);
      // Keep a heading with what follows it
      let prev = target?.previousElementSibling ?? null;
      while (prev && isGap(prev)) prev = prev.previousElementSibling;
      if (target && prev && /^H[1-4]$/.test(prev.tagName) && top(prev) > pageTop + 1) target = prev as HTMLElement;
    }

    const nextSheetTop = sheetTop + paperHeight + SHEET_GAP_PX;
    const wanted = nextSheetTop + margin;
    if (target && top(target) <= wanted) {
      const gap = insertGap(doc, target, wanted - top(target));
      // A table continuing on the new sheet gets its header row again when printed
      // (thead is a repeating header group): show the same copy in the editor
      let first: HTMLElement = target;
      const thead = target.tagName === "TR" && !target.closest("thead") ? target.closest("table")?.tHead : null;
      if (thead) {
        const copies = Array.from(thead.rows).map((row) => {
          const copy = row.cloneNode(true) as HTMLElement;
          copy.setAttribute(GAP_ATTR, "");
          copy.setAttribute("contenteditable", "false");
          return copy;
        });
        target.before(...copies);
        if (copies[0]) first = copies[0];
      }
      // Margins may collapse differently around the spacer: correct once or twice
      for (let i = 0; i < 2; i++) {
        const diff = wanted - top(first);
        if (Math.abs(diff) < 0.5) break;
        gap.style.height = `${Math.max(0, parseFloat(gap.style.height) + diff)}px`;
      }
      // Boxes continue to the bottom of the page (their background does on paper too); a table
      // split between rows ends at its last row
      // (+2px: a collapsed border sits on the row edge and belongs to the last row)
      if (gap.tagName === "TR") sheet.blankFrom = Math.min(pageBottom, top(gap) + 2);
      breakEls.push(target);
      sheetTop = nextSheetTop;
      pageTop = wanted;
    } else {
      // Can't be moved to a new sheet: continue on the same strip, marked with a dashed guide
      sheet.gapAfter = false;
      sheetTop = pageBottom - margin;
      pageTop = pageBottom;
    }
  }
  markEmptySheets(doc, sheets);
  const last = sheets[sheets.length - 1];
  return { sheets, breakEls, totalHeight: last ? last.top + paperHeight : 0 };
}

function printCss(paperSize: string): string {
  const [w, h] = paperMm(paperSize);
  return `
    @page { size: ${w}mm ${h}mm; margin: ${PRINT_MARGIN_MM}mm; }
    @media print {
      html { padding: 0 !important; }
      /* Colored boxes are part of the worksheet: print backgrounds without the dialog option */
      * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
      [data-agy-keep] { break-inside: avoid !important; page-break-inside: avoid !important; }
      [${BREAK_ATTR}] { break-before: page !important; page-break-before: always !important; }
      thead { display: table-header-group; }
      h1, h2, h3, h4 { break-after: avoid; page-break-after: avoid; }
      p { orphans: 3; widows: 3; }
    }`;
}

// Print the iframe document with the chosen paper size. In sheet view, pages break exactly where
// the sheets do. Marks and the print stylesheet exist only while printing; afterwards an input
// event makes the editor save (unchanged content) and lay the sheets out again.
export function printDocument(iframe: HTMLIFrameElement, paperSize: string, title: string, sheetView: boolean) {
  const doc = iframe.contentDocument;
  const win = iframe.contentWindow;
  if (!doc?.head || !win) return;
  const breaks = sheetView ? layoutSheets(doc, paperSize).breakEls : [];
  removeSheetGaps(doc);
  breaks.forEach((el) => el.setAttribute(BREAK_ATTR, ""));
  const blocks = findKeepBlocks(doc, pageContentHeightPx(paperSize));
  blocks.forEach((el) => el.setAttribute("data-agy-keep", ""));
  const style = doc.createElement("style");
  style.id = "agy-print";
  style.textContent = printCss(paperSize);
  doc.head.appendChild(style);
  // The document title becomes the default PDF file name
  const hadTitle = !!doc.querySelector("title");
  const oldTitle = doc.title;
  doc.title = title;

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    style.remove();
    blocks.forEach((el) => el.removeAttribute("data-agy-keep"));
    breaks.forEach((el) => el.removeAttribute(BREAK_ATTR));
    if (hadTitle) doc.title = oldTitle;
    else doc.querySelector("title")?.remove();
    doc.dispatchEvent(new Event("input", { bubbles: true }));
  };
  win.addEventListener("afterprint", cleanup, { once: true });
  win.focus();
  win.print();
}
