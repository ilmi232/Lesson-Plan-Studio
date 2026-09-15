// @ts-nocheck
import React, { useState } from 'react';
import { useStore } from '../store';
import { IframeEditor } from './IframeEditor';
import { ArrowLeft, Download, FileType, Search } from 'lucide-react';
import html2pdf from 'html2pdf.js';

export const EditorPage: React.FC = () => {
  const { currentPlanId, plans, updatePlan, setCurrentPlanId, paperSize, setPaperSize } = useStore();
  const plan = plans.find((p) => p.id === currentPlanId);
  const [showFindReplace, setShowFindReplace] = useState(false);
  const [findText, setFindText] = useState('');
  const [replaceText, setReplaceText] = useState('');

  if (!plan) return null;

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    updatePlan(plan.id, plan.content, e.target.value);
  };

  const handleExportPDF = () => {
    const element = document.getElementById('print-content');
    if (!element) return;
    
    // We need to pass the inner document body to html2pdf if we want it to render correctly,
    // or we can pass the iframe's document body
    const iframe = element.querySelector('iframe');
    const targetElement = iframe ? iframe.contentDocument.documentElement : element;

    let format: string | number[] = 'a4';
    if (paperSize === 'f4') {
      format = [215.9, 330.2]; // Custom size in mm
    } else if (paperSize === 'letter') {
      format = 'letter';
    } else if (paperSize === 'legal') {
      format = 'legal';
    }

    const opt = {
      margin:       10,
      filename:     `${plan.title}.pdf`,
      image:        { type: 'jpeg', quality: 0.98 },
      html2canvas:  { scale: 2, useCORS: true },
      jsPDF:        { unit: 'mm', format: format, orientation: 'portrait' },
      pagebreak:    { mode: ['css', 'legacy'] }
    };
    html2pdf().set(opt).from(targetElement).save();
  };

  const handleExportDocx = () => {
    // If the content is already a full HTML string with head/body, we can use it directly
    let htmlString = plan.content;
    if (!htmlString.includes('<html')) {
       htmlString = `
      <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
        <head>
          <meta charset="utf-8">
          <title>${plan.title}</title>
          <!--[if gte mso 9]>
          <xml>
            <w:WordDocument>
              <w:View>Print</w:View>
              <w:Zoom>100</w:Zoom>
              <w:DoNotOptimizeForBrowser/>
            </w:WordDocument>
          </xml>
          <![endif]-->
          <style>
            table { border-collapse: collapse; width: 100%; }
            table, th, td { border: 1px solid black; }
            th, td { padding: 8px; }
          </style>
        </head>
        <body>
          ${plan.content}
        </body>
      </html>
    `;
    }
    
    const blob = new Blob(['\ufeff', htmlString], { type: 'application/msword' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${plan.title}.doc`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleReplace = () => {
    if (!findText) return;
    const parser = new DOMParser();
    const doc = parser.parseFromString(plan.content, 'text/html');
    
    const walk = document.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, null);
    let node;
    const regex = new RegExp(findText, 'gi');
    let hasChanges = false;

    while ((node = walk.nextNode())) {
      if (regex.test(node.nodeValue || '')) {
        node.nodeValue = node.nodeValue!.replace(regex, replaceText);
        hasChanges = true;
      }
    }

    if (hasChanges) {
      updatePlan(plan.id, doc.documentElement.outerHTML);
    }
    setShowFindReplace(false);
  };

  return (
    <div className="flex flex-col h-screen bg-gray-100 overflow-hidden">
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center flex-1">
          <button
            onClick={() => setCurrentPlanId(null)}
            className="mr-4 p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-full"
            title="Kembali ke Dashboard"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <input
            type="text"
            value={plan.title}
            onChange={handleTitleChange}
            className="text-xl font-semibold text-gray-800 bg-transparent border-none focus:outline-none focus:ring-2 focus:ring-blue-500 rounded px-2 w-1/2"
          />
        </div>
        <div className="flex items-center gap-3">
          <select 
            value={paperSize} 
            onChange={(e) => setPaperSize(e.target.value)}
            className="border border-gray-300 text-gray-700 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            title="Ukuran Kertas"
          >
            <option value="a4">A4 (210 x 297mm)</option>
            <option value="f4">F4 / Folio (215.9 x 330.2mm)</option>
            <option value="letter">Letter (215.9 x 279.4mm)</option>
            <option value="legal">Legal (215.9 x 355.6mm)</option>
          </select>
          <button
            onClick={() => setShowFindReplace(!showFindReplace)}
            className="flex items-center gap-2 px-3 py-2 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md text-sm font-medium transition-colors"
          >
            <Search className="w-4 h-4" /> Cari & Ganti
          </button>
          <button
            onClick={handleExportDocx}
            className="flex items-center gap-2 px-3 py-2 text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-md text-sm font-medium transition-colors"
          >
            <FileType className="w-4 h-4" /> Export Word
          </button>
          <button
            onClick={handleExportPDF}
            className="flex items-center gap-2 px-3 py-2 text-white bg-blue-600 hover:bg-blue-700 rounded-md text-sm font-medium transition-colors"
          >
            <Download className="w-4 h-4" /> Export PDF
          </button>
        </div>
      </header>

      {showFindReplace && (
        <div className="bg-white border-b border-gray-200 p-4 flex gap-4 shrink-0 shadow-sm z-20 absolute top-16 right-4 rounded-lg border">
          <input
            type="text"
            placeholder="Cari teks..."
            value={findText}
            onChange={(e) => setFindText(e.target.value)}
            className="border border-gray-300 rounded px-3 py-1.5 text-sm"
          />
          <input
            type="text"
            placeholder="Ganti dengan..."
            value={replaceText}
            onChange={(e) => setReplaceText(e.target.value)}
            className="border border-gray-300 rounded px-3 py-1.5 text-sm"
          />
          <button
            onClick={handleReplace}
            className="bg-gray-800 text-white px-4 py-1.5 rounded text-sm hover:bg-gray-700"
          >
            Ganti Semua
          </button>
        </div>
      )}

      <div className="flex-1 overflow-hidden relative">
        <IframeEditor planId={plan.id} />
      </div>
    </div>
  );
};
