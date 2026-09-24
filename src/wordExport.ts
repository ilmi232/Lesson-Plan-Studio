// Export to a Word-readable .doc (HTML with Office namespaces), built from the live editor
// document rather than the stored source: formulas are taken as MathML (which Word turns into
// equations) instead of TeX or MathJax's CSS-drawn markup, which Word would show empty.

import { removeMathJaxStyles } from "./editorDocument";

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function buildWordHtml(doc: Document, title: string): string {
  const root = doc.documentElement.cloneNode(true) as HTMLElement;
  root.querySelectorAll("script, #agy-style, #agy-csp, #agy-print, meta[http-equiv], title").forEach((el) => el.remove());
  removeMathJaxStyles(root);
  root.querySelectorAll("[data-agy-keep]").forEach((el) => el.removeAttribute("data-agy-keep"));

  root.querySelectorAll("mjx-container").forEach((container) => {
    const mathml = container.querySelector("mjx-assistive-mml math");
    if (mathml) container.replaceWith(mathml);
    else container.replaceWith(doc.createTextNode(container.textContent ?? ""));
  });

  // Word's own page break markup
  root.querySelectorAll(".page-break").forEach((el) => {
    const br = doc.createElement("br");
    br.setAttribute("clear", "all");
    br.setAttribute("style", "mso-special-character:line-break;page-break-before:always");
    el.replaceWith(br);
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
