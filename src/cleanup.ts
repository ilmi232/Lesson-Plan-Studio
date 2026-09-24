// AI-generated lesson plans are built as web pages: they come with Print / Save PDF toolbars,
// often fixed or sticky, that float over the text in the editor and don't belong in a document.

// Class conventions for "hide when printing" (custom, Tailwind, Bootstrap 3/4+)
const PRINT_HIDDEN_SELECTOR = [
  ".no-print", ".noprint", ".no_print", ".print-hide", ".hide-print", ".hide-on-print",
  ".print-hidden", ".hidden-print", ".d-print-none", '[class~="print:hidden"]',
].join(", ");
const PRINT_HANDLER = /print\s*\(|html2pdf|jspdf|html2canvas|download/i;
const ACTION_LABEL = /print|cetak|pdf|download|unduh|save|simpan|export|ekspor/i;
// Removing an element never climbs past these: an empty cell or list item is still content
const KEEP_ANCESTOR = "td, th, tr, li, body, html";
const MAX_CHROME_TEXT = 200;

function removeWithEmptyWrappers(el: Element) {
  let parent = el.parentElement;
  el.remove();
  while (parent && !parent.matches(KEEP_ANCESTOR) && !parent.textContent?.trim() &&
         !parent.querySelector("img, table, svg, video, canvas, hr")) {
    const next: HTMLElement | null = parent.parentElement;
    parent.remove();
    parent = next;
  }
}

function isActionButton(el: Element): boolean {
  const label = (el.textContent || (el as HTMLInputElement).value || el.getAttribute("title") || "").trim();
  return label.length <= 40 && ACTION_LABEL.test(label);
}

// Toolbar-sized, no real content. Guards against print-only rules like `body * { display:none }`.
function looksLikeChrome(el: Element): boolean {
  const text = el.textContent?.trim() ?? "";
  return el.tagName !== "BODY" && text.length <= MAX_CHROME_TEXT && !el.querySelector("table, img");
}

// Run on the parsed document BEFORE sanitizing: onclick="window.print()" is the most reliable
// signal and the sanitizer strips it. Returns the number of elements removed.
export function stripPrintChrome(root: ParentNode): number {
  const targets = new Set<Element>(root.querySelectorAll(PRINT_HIDDEN_SELECTOR));
  root.querySelectorAll("[onclick]").forEach((el) => {
    if (PRINT_HANDLER.test(el.getAttribute("onclick") ?? "")) targets.add(el);
  });
  // Documents saved after sanitizing have lost onclick; a short "Print"/"Cetak PDF" button is chrome
  root.querySelectorAll('button, input[type="button"], input[type="submit"], [role="button"]').forEach((el) => {
    if (isActionButton(el)) targets.add(el);
  });
  let removed = 0;
  targets.forEach((el) => {
    if (el.isConnected) { removeWithEmptyWrappers(el); removed++; }
  });
  return removed;
}

function printHiddenSelectors(doc: Document): string[] {
  const selectors: string[] = [];
  const visit = (rules: CSSRuleList, inPrint: boolean) => {
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSMediaRule) {
        visit(rule.cssRules, inPrint || /\bprint\b/.test(rule.media.mediaText));
      } else if (inPrint && rule instanceof CSSStyleRule && rule.style.display === "none") {
        selectors.push(...rule.selectorText.split(",").map((s) => s.trim()));
      }
    }
  };
  for (const sheet of Array.from(doc.styleSheets)) {
    if ((sheet.ownerNode as Element | null)?.id === "agy-style") continue;
    try { visit(sheet.cssRules, false); } catch { /* cross-origin sheet (e.g. Google Fonts) */ }
  }
  // Universal/print-area patterns would match real content
  return selectors.filter((s) => s && !s.includes("*") && !/^(html|body)$/i.test(s));
}

const TALL_PX = 700; // ~185mm: taller than any answer box, shorter than a "paper" page
const EMPTY_GAP_PX = 300;

// Web-page heights that leave long blank areas: viewport-sized boxes (min-h-screen, 100vh,
// which also grow with the iframe) and "paper" boxes (min-height: 297mm) that are mostly empty.
// Also inflates printouts with blank pages, so the fix is saved with the document.
// Returns the number of elements changed.
export function releaseArtificialHeights(doc: Document): number {
  const win = doc.defaultView;
  if (!win || !doc.body) return 0;
  let changed = 0;
  // Deepest first, so a parent is measured after its tall children shrank
  for (const el of Array.from(doc.body.querySelectorAll<HTMLElement>("*")).reverse()) {
    if (el.closest("table, [data-agy-gap]") || el.matches("img, svg, canvas, video, iframe, math") || el.tagName.includes("-")) continue;
    const rect = el.getBoundingClientRect();
    if (rect.height < TALL_PX) continue;
    const cs = win.getComputedStyle(el);
    const viewportSized = /\d\s*[dsl]?vh\b/.test(el.getAttribute("style") ?? "") ||
      Math.abs(parseFloat(cs.minHeight) - win.innerHeight) < 2 ||
      Math.abs(parseFloat(cs.height) - win.innerHeight) < 2;
    const range = doc.createRange();
    range.selectNodeContents(el);
    const content = range.getBoundingClientRect();
    const contentBottom = content.height > 0 ? content.bottom : rect.top;
    const gap = rect.bottom - contentBottom - parseFloat(cs.paddingBottom) - parseFloat(cs.borderBottomWidth);
    if (!viewportSized && gap < EMPTY_GAP_PX) continue;
    el.style.setProperty("min-height", "0", "important");
    el.style.setProperty("height", "auto", "important");
    changed++;
  }
  return changed;
}

const px = (v: string) => parseFloat(v) || 0;

function contentRight(el: Element, win: Window): number {
  const cs = win.getComputedStyle(el);
  return el.getBoundingClientRect().right - px(cs.paddingRight) - px(cs.borderRightWidth);
}

// AI pages often use a fixed-width "paper" container (e.g. 900px, or 210mm plus padding) that
// is wider than the printable width of the page: the right side was cut off in the editor and
// on paper. Shrink whatever sticks out of its parent. Saved with the document (print needs it).
// Returns the number of elements changed.
export function fitToPageWidth(doc: Document): number {
  const win = doc.defaultView;
  if (!win || !doc.body) return 0;
  let changed = 0;
  // Document order: fixing a container usually brings its children back inside too
  for (const el of Array.from(doc.body.querySelectorAll<HTMLElement>("*"))) {
    if (!el.isConnected || el.closest("[data-agy-gap], mjx-container, svg *, math, .page-break") ||
        /^(THEAD|TBODY|TFOOT|TR|TD|TH|COL|COLGROUP|CAPTION)$/.test(el.tagName)) continue;
    const parent = el.parentElement;
    if (!parent) continue;
    const cs = win.getComputedStyle(el);
    if (cs.display === "none" || cs.display === "inline" || cs.position === "absolute") continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.right <= contentRight(parent, win) + 1) continue;
    if (/^(IMG|SVG|VIDEO|CANVAS)$/.test(el.tagName)) {
      el.style.setProperty("max-width", "100%");
      el.style.setProperty("height", "auto");
    } else if (el.tagName === "TABLE") {
      el.style.setProperty("width", "100%");
      el.style.setProperty("max-width", "100%");
      // Content that can't shrink (long words, many columns): fix the layout and wrap anywhere
      if (el.getBoundingClientRect().right > contentRight(parent, win) + 1) {
        el.style.setProperty("table-layout", "fixed");
        el.style.setProperty("overflow-wrap", "anywhere");
      }
    } else {
      el.style.setProperty("max-width", "100%");
      el.style.setProperty("box-sizing", "border-box");
      if (px(cs.marginLeft) > 0 && el.getBoundingClientRect().right > contentRight(parent, win) + 1) {
        el.style.setProperty("margin-left", "0");
      }
    }
    changed++;
  }
  return changed;
}

// Run inside the rendered iframe: catches what only the browser knows — the document's own
// @media print rules with made-up class names, and computed fixed/sticky positioning.
// Returns the number of elements changed.
export function stripRenderedChrome(doc: Document): number {
  const win = doc.defaultView;
  if (!win || !doc.body) return 0;
  let changed = 0;

  for (const selector of printHiddenSelectors(doc)) {
    let matches: Element[] = [];
    try { matches = Array.from(doc.body.querySelectorAll(selector)); } catch { continue; }
    for (const el of matches) {
      if (el.isConnected && looksLikeChrome(el)) { removeWithEmptyWrappers(el); changed++; }
    }
  }

  for (const el of Array.from(doc.body.querySelectorAll<HTMLElement>("*"))) {
    if (!el.isConnected || el.closest("[data-agy-gap]")) continue;
    const position = win.getComputedStyle(el).position;
    if (position !== "fixed" && position !== "sticky") continue;
    const hasAction = isActionButton(el) || Array.from(el.querySelectorAll("button, [role='button']")).some(isActionButton);
    if (looksLikeChrome(el) && hasAction) {
      removeWithEmptyWrappers(el);
    } else {
      // Real content that was pinned (e.g. a sticky title): keep it, in normal document flow
      el.style.setProperty("position", "static", "important");
    }
    changed++;
  }
  return changed;
}
