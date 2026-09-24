// Export to a Word-readable .doc (HTML with Office namespaces), built from the live editor
// document rather than the stored source. Word's HTML import ignores a lot of CSS, so the
// parts of a worksheet that depend on it are rewritten into forms Word does understand
// (verified by opening the export in Microsoft Word):
// - fill-in blanks (empty inline boxes with a bottom border) -> underscores
// - answer/work boxes (bordered boxes taller than their content) -> one-cell table with a height
// - formulas (MathML, which Word shows as flattened text: "7½" became "712") -> sup/sub/fraction HTML

import { removeMathJaxStyles } from "./editorDocument";

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const px = (v: string) => parseFloat(v) || 0;

// MathML -> inline HTML that Word renders faithfully
function mathToHtml(node: Element): string {
  const kids = () => Array.from(node.children).map(mathToHtml).join("");
  const arg = (i: number) => (node.children[i] ? mathToHtml(node.children[i]) : "");
  const simple = (i: number) => (node.children[i]?.children.length ?? 0) === 0;
  const text = escapeHtml(node.textContent ?? "");
  switch (node.localName) {
    case "mi": return text.length === 1 ? `<i>${text}</i>` : text;
    case "mn": case "mtext": case "ms": return text;
    case "mo": return ` ${text} `.replace(/^ ([([{|,.]) $/, "$1").replace(/^ ([)\]}]) $/, "$1");
    case "mspace": return " ";
    case "msup": return `${arg(0)}<sup>${arg(1)}</sup>`;
    case "msub": return `${arg(0)}<sub>${arg(1)}</sub>`;
    case "msubsup": return `${arg(0)}<sub>${arg(1)}</sub><sup>${arg(2)}</sup>`;
    case "mfrac": return simple(0) && simple(1)
      ? `<sup>${arg(0)}</sup>&frasl;<sub>${arg(1)}</sub>`
      : `(${arg(0)})/(${arg(1)})`;
    case "msqrt": return `√(${kids()})`;
    case "mroot": return `<sup>${arg(1)}</sup>√(${arg(0)})`;
    case "mover": case "munder": case "munderover": return kids();
    case "semantics": return arg(0);
    case "annotation": case "annotation-xml": return "";
    default: return kids();
  }
}

function hasBorder(cs: CSSStyleDeclaration): boolean {
  return ["Top", "Right", "Bottom", "Left"].some((s) =>
    px(cs.getPropertyValue(`border-${s.toLowerCase()}-width`)) > 0 && cs.getPropertyValue(`border-${s.toLowerCase()}-style`) !== "none");
}

function borderCss(cs: CSSStyleDeclaration): string {
  const side = ["top", "right", "bottom", "left"].find((s) => px(cs.getPropertyValue(`border-${s}-width`)) > 0) ?? "top";
  const style = cs.getPropertyValue(`border-${side}-style`);
  return `${Math.max(1, px(cs.getPropertyValue(`border-${side}-width`)))}px ${style === "none" ? "solid" : style} ${cs.getPropertyValue(`border-${side}-color`)}`;
}

export function buildWordHtml(doc: Document, title: string): string {
  const win = doc.defaultView!;
  const root = doc.documentElement.cloneNode(true) as HTMLElement;
  // Live and cloned body elements line up by index (the clone is untouched until now)
  const live = Array.from(doc.body.querySelectorAll<HTMLElement>("*"));
  const copies = Array.from(root.querySelector("body")!.querySelectorAll<HTMLElement>("*"));

  live.forEach((el, i) => {
    const copy = copies[i];
    // Word table cells don't inherit the document font (they fall back to Times New Roman)
    if (copy && (el.tagName === "TD" || el.tagName === "TH")) {
      const cs = win.getComputedStyle(el);
      copy.style.fontFamily = cs.fontFamily;
      copy.style.fontSize = cs.fontSize;
      copy.style.color = cs.color;
    }
    // Content inside table cells (answer boxes, blanks) is converted too; the table parts themselves are not
    if (!copy || el.closest("mjx-container, svg, math, [data-agy-gap]") || /^(TABLE|THEAD|TBODY|TFOOT|TR|TD|TH|COL|COLGROUP|CAPTION)$/.test(el.tagName)) return;
    const cs = win.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const empty = !el.textContent?.trim() && !el.querySelector("img, svg, table, math, mjx-container");

    // Fill-in blank: an empty inline box drawn as a line
    if (empty && cs.display.startsWith("inline") && px(cs.borderBottomWidth) > 0 && rect.width > 10) {
      copy.replaceWith(doc.createTextNode("_".repeat(Math.max(4, Math.round(rect.width / 7)))));
      return;
    }
    // Answer / work box: bordered and clearly taller than what's inside
    if (!cs.display.startsWith("inline") && hasBorder(cs) && rect.height >= 30) {
      const range = doc.createRange();
      range.selectNodeContents(el);
      const content = range.getBoundingClientRect();
      const contentBottom = content.height > 0 ? content.bottom : rect.top;
      if (rect.bottom - contentBottom > 24) {
        const table = doc.createElement("table");
        table.setAttribute("style", `width:100%;border-collapse:collapse;margin:${cs.marginTop} 0 ${cs.marginBottom} 0`);
        table.setAttribute("cellpadding", "0");
        const td = table.insertRow().insertCell();
        td.setAttribute("height", String(Math.round(rect.height)));
        td.setAttribute("valign", "top");
        td.setAttribute("style", `height:${Math.round(rect.height)}px;border:${borderCss(cs)};padding:${cs.padding};background:${cs.backgroundColor};` +
          `font-family:${cs.fontFamily};font-size:${cs.fontSize};color:${cs.color}`);
        while (copy.firstChild) td.appendChild(copy.firstChild);
        if (!td.textContent?.trim()) td.innerHTML = "&nbsp;";
        copy.replaceWith(table);
      }
    }
  });

  root.querySelectorAll("script, #agy-style, #agy-csp, #agy-print, meta[http-equiv], title, [data-agy-gap]").forEach((el) => el.remove());
  removeMathJaxStyles(root);
  root.querySelectorAll("[data-agy-keep]").forEach((el) => el.removeAttribute("data-agy-keep"));

  root.querySelectorAll("mjx-container").forEach((container) => {
    const mathml = container.querySelector("mjx-assistive-mml math");
    const span = doc.createElement("span");
    span.setAttribute("style", "font-family:'Cambria Math','Times New Roman',serif");
    span.innerHTML = mathml ? mathToHtml(mathml).replace(/\s{2,}/g, " ").trim() : escapeHtml(container.textContent ?? "");
    container.replaceWith(span);
  });

  // Page breaks in the form Word itself writes: the break <br> inside its own paragraph.
  // (A bare <br> was merged into the next box, leaving a strip of its background at the bottom
  // of the page; page-break-before on a <div> is ignored by Word.)
  root.querySelectorAll(".page-break").forEach((el) => {
    const p = doc.createElement("p");
    p.setAttribute("style", "margin:0;line-height:1px;font-size:1px");
    const br = doc.createElement("br");
    br.setAttribute("clear", "all");
    br.setAttribute("style", "mso-special-character:line-break;page-break-before:always");
    p.appendChild(br);
    el.replaceWith(p);
  });

  const head = root.querySelector("head")?.innerHTML ?? "";
  const body = root.querySelector("body")?.outerHTML ?? "<body></body>";
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns:m="http://schemas.microsoft.com/office/2004/12/omml" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom><w:DoNotOptimizeForBrowser/></w:WordDocument></xml><![endif]-->
${head}
</head>
${body}
</html>`;
}
