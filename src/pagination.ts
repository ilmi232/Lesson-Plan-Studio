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
    if (el.tagName.includes("-") || el.closest("svg, math, .page-break")) continue;
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

function printCss(paperSize: string): string {
  const [w, h] = paperMm(paperSize);
  return `
    @page { size: ${w}mm ${h}mm; margin: ${PRINT_MARGIN_MM}mm; }
    @media print {
      html { padding: 0 !important; }
      /* Colored boxes are part of the worksheet: print backgrounds without the dialog option */
      * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
      [data-agy-keep] { break-inside: avoid !important; page-break-inside: avoid !important; }
      thead { display: table-header-group; }
      h1, h2, h3, h4 { break-after: avoid; page-break-after: avoid; }
      p { orphans: 3; widows: 3; }
    }`;
}

// Print the iframe document with the chosen paper size. Keep-together marks and the print
// stylesheet exist only while printing, so they never reach the saved document.
export function printDocument(iframe: HTMLIFrameElement, paperSize: string, title: string) {
  const doc = iframe.contentDocument;
  const win = iframe.contentWindow;
  if (!doc?.head || !win) return;
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
    if (hadTitle) doc.title = oldTitle;
    else doc.querySelector("title")?.remove();
  };
  win.addEventListener("afterprint", cleanup, { once: true });
  win.focus();
  win.print();
}
