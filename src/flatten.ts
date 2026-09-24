// "Rapikan Dokumen" without AI: bake the rendered look of every element into inline styles,
// then drop classes, stylesheets and the Tailwind CDN. The document looks the same, but no
// longer depends on a framework: Word export keeps the styling, nothing fights the table
// resizer, and the page renders offline.

import { freezeColumnWidths } from "./tableOps";
import { restoreMath } from "./restructure";

// Inherited: written only when different from the parent's value
const INHERITED = [
  "color", "font-family", "font-size", "font-weight", "font-style", "line-height",
  "text-align", "text-transform", "letter-spacing", "white-space", "list-style-type",
];
// Not inherited: written only when different from the browser default for that tag
const SIDES = ["top", "right", "bottom", "left"];
const BOX = [
  "display", "background-color", "background-image",
  ...SIDES.flatMap((s) => [`padding-${s}`, `margin-${s}`]),
  "border-top-left-radius", "border-top-right-radius", "border-bottom-right-radius", "border-bottom-left-radius",
  "vertical-align",
  "flex-direction", "flex-wrap", "justify-content", "align-items", "row-gap", "column-gap",
  "flex-grow", "flex-shrink", "flex-basis", "grid-column-start", "grid-column-end",
  "border-collapse", "table-layout", "list-style-position",
];
const TABLE_PARTS = new Set(["TABLE", "THEAD", "TBODY", "TFOOT", "TR", "TD", "TH", "COL", "COLGROUP", "CAPTION"]);
const MEDIA = new Set(["IMG", "SVG", "CANVAS", "VIDEO"]);
const SKIP = "script, style, link, meta, title, svg *, math, math *, mjx-container, mjx-container *";
const TALL_PX = 700;

// Browser defaults per tag, read from an unstyled document
class Defaults {
  private frame: HTMLIFrameElement;
  private cache = new Map<string, Map<string, string>>();
  constructor() {
    this.frame = document.createElement("iframe");
    Object.assign(this.frame.style, { position: "absolute", width: "0", height: "0", border: "0", visibility: "hidden" });
    document.body.appendChild(this.frame);
  }
  get(tag: string, prop: string): string {
    let values = this.cache.get(tag);
    if (!values) {
      const doc = this.frame.contentDocument!;
      const el = doc.createElement(tag);
      doc.body.appendChild(el);
      const cs = this.frame.contentWindow!.getComputedStyle(el);
      values = new Map(BOX.map((p) => [p, cs.getPropertyValue(p)]));
      el.remove();
      this.cache.set(tag, values);
    }
    return values.get(prop) ?? "";
  }
  dispose() { this.frame.remove(); }
}

const px = (value: string) => parseFloat(value) || 0;

function contentWidth(el: Element, win: Window): number {
  const cs = win.getComputedStyle(el);
  return el.getBoundingClientRect().width - px(cs.paddingLeft) - px(cs.paddingRight) - px(cs.borderLeftWidth) - px(cs.borderRightWidth);
}

// Style declarations for one element, from its computed style
function styleFor(el: HTMLElement, win: Window, defaults: Defaults): Map<string, string> {
  const cs = win.getComputedStyle(el);
  const parent = el.parentElement;
  const parentCs = parent ? win.getComputedStyle(parent) : null;
  const tag = el.tagName.toLowerCase();
  const out = new Map<string, string>();
  const isBody = el.tagName === "BODY";

  for (const prop of INHERITED) {
    const value = cs.getPropertyValue(prop);
    if (isBody || !parentCs || value !== parentCs.getPropertyValue(prop)) out.set(prop, value);
  }
  for (const prop of BOX) {
    const value = cs.getPropertyValue(prop);
    if (value !== defaults.get(tag, prop)) out.set(prop, value);
  }
  for (const side of SIDES) {
    const width = cs.getPropertyValue(`border-${side}-width`);
    const style = cs.getPropertyValue(`border-${side}-style`);
    if (px(width) > 0 && style !== "none") {
      out.set(`border-${side}`, `${width} ${style} ${cs.getPropertyValue(`border-${side}-color`)}`);
    }
  }
  if (out.get("background-image") === "none") out.delete("background-image");
  // Underline/strike-through: its color defaults to the text color, so only write it when used
  const decoration = cs.getPropertyValue("text-decoration-line");
  if (decoration !== "none" && decoration !== (parentCs?.getPropertyValue("text-decoration-line") ?? "none")) {
    out.set("text-decoration", `${decoration} ${cs.getPropertyValue("text-decoration-style")} ${cs.getPropertyValue("text-decoration-color")}`);
  }

  // Grid tracks resolve to px; keep their proportions instead
  const tracks = cs.gridTemplateColumns;
  if (cs.display.includes("grid") && tracks && tracks !== "none") {
    const sizes = tracks.split(/\s+/).map(px).filter((n) => n > 0);
    if (sizes.length) out.set("grid-template-columns", sizes.map((n) => `minmax(0, ${n.toFixed(1)}fr)`).join(" "));
  }

  const rect = el.getBoundingClientRect();
  const inTable = TABLE_PARTS.has(el.tagName) && el.tagName !== "TABLE";

  // Widths: only where they are an explicit design choice
  if (MEDIA.has(el.tagName)) {
    out.set("width", `${rect.width.toFixed(1)}px`);
    out.set("height", `${rect.height.toFixed(1)}px`);
  } else if (!inTable && !isBody && parent) {
    if (cs.display.startsWith("inline-")) {
      out.set("width", `${rect.width.toFixed(1)}px`);
    } else if (cs.display !== "inline") {
      const available = contentWidth(parent, win);
      const parentLayout = parentCs?.display ?? "";
      const flexItemFixed = parentLayout.includes("flex") && px(cs.flexGrow) === 0;
      // Rounded up: a hair too narrow wraps "Name: ____" onto a second line
      const pct = Math.ceil((rect.width / available) * 10000) / 100;
      if (el.tagName === "TABLE") {
        if (available > 0) out.set("width", pct >= 99 ? "100%" : `${pct}%`);
      } else if (available > 0 && rect.width < available * 0.95 && (!parentLayout.match(/flex|grid/) || flexItemFixed)) {
        out.set("width", `${pct}%`);
      }
    }
  }

  // Heights: answer boxes, fill-in lines and dividers are taller than their content
  if (el.tagName === "COL") {
    // Column widths come from the <colgroup> (frozen as percentages before flattening)
    if (el.style.width) out.set("width", el.style.width);
  } else if (el.tagName === "TR" && el.style.height) {
    out.set("height", el.style.height);
  } else if (!inTable && !isBody && cs.display !== "inline" && !MEDIA.has(el.tagName) && rect.height < TALL_PX) {
    const empty = !el.textContent?.trim() && el.children.length === 0;
    if (empty) {
      out.set("height", `${rect.height.toFixed(1)}px`);
    } else {
      const range = el.ownerDocument.createRange();
      range.selectNodeContents(el);
      const content = range.getBoundingClientRect();
      const gap = rect.bottom - content.bottom - px(cs.paddingBottom) - px(cs.borderBottomWidth);
      if (gap > 8) out.set("min-height", `${rect.height.toFixed(1)}px`);
    }
  }
  // Sizes above are border-box measurements (getBoundingClientRect), whatever the original CSS said
  if (el.tagName !== "COL" && (out.has("width") || out.has("height") || out.has("min-height"))) {
    out.set("box-sizing", "border-box");
  }
  return out;
}

export interface FlattenResult {
  html: string;
  pseudoTables: number;
}

// Rows and columns laid out with grid/flex instead of <table> (what the AI step can convert)
export function countPseudoTables(doc: Document): number {
  const win = doc.defaultView;
  if (!win || !doc.body) return 0;
  let count = 0;
  const counted = new Set<Element>();
  for (const el of Array.from(doc.body.querySelectorAll<HTMLElement>("*"))) {
    const cs = win.getComputedStyle(el);
    if (cs.display.includes("grid")) {
      const cols = cs.gridTemplateColumns.split(/\s+/).filter((t) => px(t) > 0).length;
      if (cols >= 2 && el.children.length >= cols * 2) { count++; counted.add(el); }
    } else if (cs.display.includes("flex") && !cs.flexDirection.startsWith("column") && el.parentElement && !counted.has(el.parentElement)) {
      // Several sibling flex rows with the same number of cells
      const rows = Array.from(el.parentElement.children).filter((s) => {
        const sc = win.getComputedStyle(s);
        return sc.display.includes("flex") && !sc.flexDirection.startsWith("column") && s.children.length === el.children.length;
      });
      if (el.children.length >= 2 && rows.length >= 3 && rows[0] === el) { count++; counted.add(el.parentElement); }
    }
  }
  return count;
}

export function flattenDocument(liveDoc: Document, title: string): FlattenResult {
  const win = liveDoc.defaultView!;
  // Column widths from classes/percent cols become a percent <colgroup> (same as the resizer)
  liveDoc.querySelectorAll("table").forEach((t) => { if (t.rows.length) freezeColumnWidths(t); });

  const pseudoTables = countPseudoTables(liveDoc);
  const defaults = new Defaults();
  const liveEls = [liveDoc.body, ...Array.from(liveDoc.body.querySelectorAll<HTMLElement>("*"))];
  const styles = liveEls.map((el) => (el.matches(SKIP) || el.tagName.includes("-") ? null : styleFor(el, win, defaults)));
  defaults.dispose();

  const clone = liveDoc.body.cloneNode(true) as HTMLElement;
  const cloneEls = [clone, ...Array.from(clone.querySelectorAll<HTMLElement>("*"))];
  cloneEls.forEach((el, i) => {
    const decl = styles[i];
    if (!decl) return;
    el.removeAttribute("style");
    decl.forEach((value, prop) => el.style.setProperty(prop, value));
    if (!el.classList.contains("page-break")) el.removeAttribute("class");
  });
  restoreMath(liveDoc.body, clone);
  clone.querySelectorAll("script, style, link").forEach((el) => el.remove());

  // Web fonts are referenced by the inlined font-family, so their stylesheets stay
  const fonts = Array.from(liveDoc.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"][href*="fonts.googleapis.com"]'))
    .map((l) => `<link rel="stylesheet" href="${l.href}">`).join("");
  const hasMath = !!liveDoc.querySelector("mjx-container") || /\$[^$]+\$/.test(clone.textContent ?? "");
  const mathjax = hasMath
    ? '<script id="MathJax-script" async src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js"></script>'
    : "";
  const safeTitle = title.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const html = `<html><head><meta charset="utf-8"><title>${safeTitle}</title>${fonts}${mathjax}</head>${clone.outerHTML}</html>`;
  return { html, pseudoTables };
}
