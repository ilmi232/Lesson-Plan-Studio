// "Rapikan Dokumen (AI)": Gemini rewrites the FORMAT of a whole document (grid/flex pseudo-tables
// to real tables, Tailwind classes to inline styles) following the shared format rules.
// The document is sent in parts so long documents fit the model's output limit, and every part
// is checked word by word: a part whose text changed is retried once, then left as it was.

import { callGemini, GeminiTruncatedError } from "./gemini";
import { buildRestructurePrompt, PAGE_BREAK_MARKER } from "./aiPrompt";
import { stripPrintChrome } from "./cleanup";
import { sanitizeFragment } from "./sanitize";
import { DEFAULT_TEMPLATE } from "./editorDocument";

// Source HTML per request. Output is usually similar in size (classes become inline styles),
// which keeps each answer well below the output token limit.
const MAX_PART_CHARS = 12000;

export interface PartResult {
  status: "restructured" | "kept";
  reason?: string;
}

export interface RestructureResult {
  html: string;
  parts: PartResult[];
}

interface Options {
  apiKey: string;
  paperSize: string;
  title: string;
  onProgress: (label: string) => void;
}

// Page breaks have no text, so the word check can't notice the AI dropping one (e.g. by
// removing class="page-break"). Send them as a text marker instead: the word check then
// guarantees the marker survives, and it is turned back into a page break afterwards.
function pageBreaksToMarkers(root: HTMLElement) {
  root.querySelectorAll(".page-break").forEach((el) => {
    const p = root.ownerDocument.createElement("p");
    p.textContent = `[[${PAGE_BREAK_MARKER}]]`;
    el.replaceWith(p);
  });
}

function markersToPageBreaks(body: HTMLElement) {
  const doc = body.ownerDocument;
  const walker = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  const hits: Text[] = [];
  while (walker.nextNode()) {
    if (walker.currentNode.nodeValue?.includes(PAGE_BREAK_MARKER)) hits.push(walker.currentNode as Text);
  }
  for (const text of hits) {
    const block = text.parentElement?.closest("p, div, li, td, th, h1, h2, h3, h4, h5, h6") ?? text.parentElement;
    const pageBreak = doc.createElement("div");
    pageBreak.className = "page-break";
    text.nodeValue = (text.nodeValue ?? "").replace(new RegExp(`\\[*\\s*${PAGE_BREAK_MARKER}\\s*\\]*`, "g"), "");
    if (block && block !== body && !block.textContent?.trim() && !block.closest("td, th, li")) block.replaceWith(pageBreak);
    else if (block && block !== body) block.after(pageBreak);
    else body.appendChild(pageBreak);
  }
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Text nodes joined with spaces: "<p>a</p><p>b</p>" must give two words, not "ab"
function wordsOf(html: string): string[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script, style").forEach((el) => el.remove());
  const texts: string[] = [];
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) texts.push(walker.currentNode.nodeValue ?? "");
  return texts.join(" ").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

export interface WordDiff {
  missing: string[];
  extra: string[];
  ok: boolean;
}

// Multiset comparison: order-insensitive, so moving a word into a table cell is fine,
// but dropping, translating or inventing words is not.
export function compareWords(before: string[], after: string[]): WordDiff {
  const counts = new Map<string, number>();
  before.forEach((w) => counts.set(w, (counts.get(w) ?? 0) + 1));
  const extra: string[] = [];
  after.forEach((w) => {
    const n = counts.get(w) ?? 0;
    if (n > 0) counts.set(w, n - 1);
    else extra.push(w);
  });
  const missing = Array.from(counts.entries()).flatMap(([w, n]) => Array(n).fill(w));
  // Exact: any allowance lets a translated header or a changed number slip through, and a
  // rejected part only means that part stays as it was.
  const ok = missing.length === 0 && extra.length === 0;
  return { missing, extra, ok };
}

// MathJax replaces $...$ with rendered markup. Put the TeX back so the AI sees (and keeps) the
// formula; fall back to the MathML MathJax keeps for screen readers, which Chrome renders natively.
function restoreMath(liveBody: HTMLElement, clone: HTMLElement) {
  const texByContainer = new Map<Element, string>();
  const mathDoc = (liveBody.ownerDocument.defaultView as any)?.MathJax?.startup?.document;
  try {
    for (const item of mathDoc?.math ?? []) {
      if (item?.typesetRoot && typeof item.math === "string") {
        texByContainer.set(item.typesetRoot, item.display ? `$$${item.math}$$` : `$${item.math}$`);
      }
    }
  } catch { /* MathJax not loaded or a different version */ }
  const live = Array.from(liveBody.querySelectorAll("mjx-container"));
  const copies = Array.from(clone.querySelectorAll("mjx-container"));
  copies.forEach((copy, i) => {
    const tex = live[i] && texByContainer.get(live[i]);
    const mathml = copy.querySelector("mjx-assistive-mml math");
    if (tex) copy.replaceWith(clone.ownerDocument.createTextNode(tex));
    else if (mathml) copy.replaceWith(mathml);
  });
}

// AI pages usually wrap everything in one centered "paper" container; descend into it so the
// content can be split, dropping the web-page wrapper along the way.
function contentRoot(body: HTMLElement): HTMLElement {
  let root = body;
  while (root.children.length === 1 &&
         Array.from(root.childNodes).every((n) => n.nodeType !== Node.TEXT_NODE || !n.nodeValue?.trim()) &&
         !["TABLE", "UL", "OL"].includes(root.children[0].tagName)) {
    root = root.children[0] as HTMLElement;
  }
  return root;
}

function splitParts(root: HTMLElement): string[] {
  const parts: string[] = [];
  let current = "";
  for (const node of Array.from(root.childNodes)) {
    let html = "";
    if (node.nodeType === Node.ELEMENT_NODE) html = (node as Element).outerHTML;
    else if (node.nodeType === Node.TEXT_NODE && node.nodeValue?.trim()) html = `<p>${escapeHtml(node.nodeValue.trim())}</p>`;
    if (!html) continue;
    if (current && current.length + html.length > MAX_PART_CHARS) {
      parts.push(current);
      current = "";
    }
    current += html + "\n";
  }
  if (current.trim()) parts.push(current);
  return parts;
}

function answerToFragment(answer: string): string {
  // The AI sometimes returns a full document despite the rules; keep only the body
  const parsed = new DOMParser().parseFromString(answer, "text/html");
  stripPrintChrome(parsed.body);
  return sanitizeFragment(parsed.body.innerHTML);
}

// Words are checked with the markers still in place; convert them only for the final document
function finalizePart(html: string): string {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  markersToPageBreaks(parsed.body);
  return parsed.body.innerHTML;
}

async function restructurePart(source: string, index: number, total: number, opts: Options): Promise<{ html: string; result: PartResult }> {
  const before = wordsOf(source);
  let note: string | undefined;
  let diff: WordDiff | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const label = `Bagian ${index + 1}/${total}${attempt > 0 ? " (ulang)" : ""}...`;
    opts.onProgress(label);
    let answer: string;
    try {
      answer = await callGemini(opts.apiKey, buildRestructurePrompt(opts.paperSize, source, index + 1, total, note), {
        temperature: 0.1,
        onRetry: (n) => opts.onProgress(`${label} server sibuk, coba lagi (${n})`),
      });
    } catch (err) {
      if (err instanceof GeminiTruncatedError) {
        return { html: source, result: { status: "kept", reason: "bagian terlalu panjang untuk AI" } };
      }
      throw err; // key/overload/network problems affect every part: abort the whole run
    }
    const html = answerToFragment(answer);
    diff = compareWords(before, wordsOf(html));
    if (diff.ok) return { html, result: { status: "restructured" } };
    note = `Percobaan sebelumnya MENGUBAH ISI teks dan ditolak.` +
      (diff.missing.length ? ` Kata yang hilang: ${diff.missing.slice(0, 15).join(", ")}.` : "") +
      (diff.extra.length ? ` Kata yang ditambahkan: ${diff.extra.slice(0, 15).join(", ")}.` : "") +
      ` Ulangi dengan semua teks persis sama seperti aslinya.`;
  }
  return {
    html: source,
    result: {
      status: "kept",
      reason: `AI mengubah isi — hilang: "${diff!.missing.slice(0, 6).join(", ")}"` +
        (diff!.extra.length ? `; bertambah: "${diff!.extra.slice(0, 6).join(", ")}"` : ""),
    },
  };
}

export async function restructureDocument(liveDoc: Document, opts: Options): Promise<RestructureResult> {
  const clone = liveDoc.body.cloneNode(true) as HTMLElement;
  restoreMath(liveDoc.body, clone);
  clone.querySelectorAll("script, style, link").forEach((el) => el.remove());
  pageBreaksToMarkers(clone);
  const sources = splitParts(contentRoot(clone));
  if (sources.length === 0) throw new Error("Dokumen kosong.");

  const htmlParts: string[] = [];
  const parts: PartResult[] = [];
  for (let i = 0; i < sources.length; i++) {
    const { html, result } = await restructurePart(sources[i], i, sources.length, opts);
    htmlParts.push(finalizePart(html));
    parts.push(result);
  }

  let html = DEFAULT_TEMPLATE(htmlParts.join("\n"));
  html = html.replace("<head>", `<head><title>${escapeHtml(opts.title)}</title>`);
  // Parts left unchanged still rely on the Tailwind classes they came with
  const tailwind = liveDoc.querySelector<HTMLScriptElement>('script[src*="tailwindcss"]');
  if (tailwind && parts.some((p) => p.status === "kept")) {
    html = html.replace("</head>", `<script src="${tailwind.getAttribute("src")}"></script></head>`);
  }
  return { html, parts };
}
