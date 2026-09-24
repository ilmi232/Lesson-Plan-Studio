// The editor iframe shares the app's origin, so any script in a document could read
// localStorage (all plans + the Gemini API key). Documents come from AI output and the
// clipboard, so everything is sanitized before it is rendered or inserted.

// External scripts that documents legitimately rely on (math rendering, Tailwind styling).
// Matched on exact origin + path prefix, so look-alike hosts don't pass.
const TRUSTED_SCRIPTS: { origin: string; path: string }[] = [
  { origin: 'https://cdn.jsdelivr.net', path: '/npm/mathjax@' },
  { origin: 'https://cdnjs.cloudflare.com', path: '/ajax/libs/mathjax/' },
  { origin: 'https://cdn.tailwindcss.com', path: '/' },
  { origin: 'https://cdn.jsdelivr.net', path: '/npm/@tailwindcss/browser@' },
];

// Defense in depth: even if the sanitizer misses something, inline scripts, event handler
// attributes and javascript: URLs are blocked, and scripts only load from these hosts.
export const EDITOR_CSP =
  "script-src https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://cdn.tailwindcss.com; " +
  "object-src 'none'; frame-src 'none'; base-uri 'none'";

const DANGEROUS_ELEMENTS = 'iframe, frame, frameset, object, embed, applet, base, meta[http-equiv="refresh" i]';
const URL_ATTRIBUTES = new Set(['href', 'src', 'action', 'formaction', 'xlink:href', 'data', 'poster', 'background']);

function isTrustedScript(src: string): boolean {
  try {
    const url = new URL(src, 'https://invalid.local');
    return TRUSTED_SCRIPTS.some((t) => url.origin === t.origin && url.pathname.startsWith(t.path));
  } catch {
    return false;
  }
}

function isDangerousUrl(value: string): boolean {
  // Browsers ignore whitespace/control characters inside the scheme ("java\tscript:")
  // eslint-disable-next-line no-control-regex
  const normalized = value.replace(/[\u0000- ]/g, '').toLowerCase();
  return /^(javascript|vbscript):/.test(normalized) || normalized.startsWith('data:text/html');
}

function sanitizeTree(root: ParentNode) {
  root.querySelectorAll('script').forEach((script) => {
    const src = script.getAttribute('src');
    if (!src || !isTrustedScript(src)) script.remove();
  });
  root.querySelectorAll(DANGEROUS_ELEMENTS).forEach((el) => el.remove());
  root.querySelectorAll('*').forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on') || name === 'srcdoc' || (URL_ATTRIBUTES.has(name) && isDangerousUrl(attr.value))) {
        el.removeAttribute(attr.name);
      }
    }
  });
}

// For a complete document: returns the parsed, sanitized Document for further processing.
export function sanitizeDocument(html: string): Document {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  sanitizeTree(doc);
  return doc;
}

// For HTML fragments inserted into an existing document (paste, AI output).
export function sanitizeFragment(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  sanitizeTree(doc.body);
  doc.body.querySelectorAll('script').forEach((el) => el.remove()); // never insert scripts into a live document
  return doc.body.innerHTML;
}
