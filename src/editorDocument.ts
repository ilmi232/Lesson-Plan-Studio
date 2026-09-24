// Turning stored HTML into the editor iframe's document and back.
import { sanitizeTree, EDITOR_CSP } from "./sanitize";
import { stripPrintChrome } from "./cleanup";

// Editor-only CSS (#agy-style) and resize cursors must never reach the stored document:
// otherwise exports carry editor visuals and old documents never pick up CSS fixes.
export function serializeDoc(doc: Document): string {
  const root = doc.documentElement.cloneNode(true) as HTMLElement;
  root.querySelectorAll("#agy-style, #agy-csp").forEach((el) => el.remove());
  root.querySelectorAll<HTMLElement>("td, th").forEach((cell) => {
    if (!cell.style.cursor) return;
    cell.style.cursor = "";
    if (!cell.getAttribute("style")) cell.removeAttribute("style");
  });
  return root.outerHTML;
}

export const DEFAULT_TEMPLATE = (body: string) => `<html><head>
  <meta charset="utf-8">
  <script id="MathJax-script" async src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js"></script>
  <style>body { font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif; padding: 20px; line-height: 1.5; } table { border-collapse: collapse; width: 100%; } table, th, td { border: 1px solid #ccc; padding: 8px; }</style>
  </head><body>${body}</body></html>`;

// Turn stored/pasted HTML into a safe full document for the iframe: wrap fragments in the
// default template, strip AI print toolbars (before sanitizing, which removes their onclick)
// and editor-only elements saved by older versions, sanitize, and put the CSP first in <head>
// so it covers everything after it.
export function prepareForEditor(html: string): string {
  const source = html.toLowerCase().includes("<html") ? html : DEFAULT_TEMPLATE(html);
  const parsed = new DOMParser().parseFromString(source, "text/html");
  stripPrintChrome(parsed.body);
  sanitizeTree(parsed);
  parsed.querySelectorAll("#agy-style, #agy-csp").forEach((el) => el.remove());
  const csp = parsed.createElement("meta");
  csp.id = "agy-csp";
  csp.httpEquiv = "Content-Security-Policy";
  csp.content = EDITOR_CSP;
  parsed.head.prepend(csp);
  return parsed.documentElement.outerHTML;
}

export function writeToIframe(iframe: HTMLIFrameElement, html: string) {
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
export function onceParsed(doc: Document, fn: () => void) {
  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", fn, { once: true });
  else fn();
}
