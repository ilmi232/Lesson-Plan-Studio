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
    if (!el.isConnected) continue;
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
