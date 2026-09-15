import React, { useEffect, useRef } from 'react';
import { useStore } from '../store';
import { Bold, Italic, Underline as UnderlineIcon, List, ListOrdered, Undo, Redo, Wand2 } from 'lucide-react';

interface IframeEditorProps {
  planId: string;
}

export const IframeEditor: React.FC<IframeEditorProps> = ({ planId }) => {
  const { plans, updatePlan, paperSize } = useStore();
  const plan = plans.find((p) => p.id === planId);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Initialize the iframe document
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !plan) return;

    const doc = iframe.contentDocument;
    if (!doc) return;

    // Only set content if the iframe is empty (to preserve cursor/focus during typing)
    if (doc.body && doc.body.innerHTML.length > 0) return;

    let content = plan.content;
    // Auto-inject MathJax if not present just in case
    if (!content.includes('MathJax')) {
       content = `
       <!DOCTYPE html><html><head>
       <meta charset="utf-8">
       <style>
         body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 20px; line-height: 1.5; overflow-y: hidden; }
         table { border-collapse: collapse; width: 100%; }
         table, th, td { border: 1px solid black; padding: 8px; }
       </style>
       <script>
         MathJax = { tex: { inlineMath: [['$', '$'], ['\\\\(', '\\\\)']] } }
       </script>
       <script id="MathJax-script" async src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js"></script>
       </head><body>${content}</body></html>`;
    } else {
       // If it already has HTML, we should still try to hide the iframe scrollbar
       // We can inject a style tag before closing head
       content = content.replace('</head>', '<style>html, body { overflow-y: hidden !important; }</style></head>');
    }

    doc.open();
    doc.write(content);
    doc.close();

    doc.designMode = 'on';

    const adjustHeight = () => {
      if (iframeRef.current && doc.body) {
        iframeRef.current.style.height = '0px'; // Reset to shrink if needed
        const newHeight = doc.body.scrollHeight;
        iframeRef.current.style.height = `${newHeight + 50}px`; // Add padding bottom
      }
    };

    const handleInput = () => {
      updatePlan(planId, doc.documentElement.outerHTML);
      adjustHeight();
    };

    doc.addEventListener('input', handleInput);
    
    // Auto-resize on initial load and when images/mathjax load
    setTimeout(adjustHeight, 100);
    setTimeout(adjustHeight, 1000); // MathJax might take a moment
    setTimeout(adjustHeight, 3000);

    const observer = new MutationObserver(adjustHeight);
    observer.observe(doc.body, { childList: true, subtree: true, characterData: true, attributes: true });
    
    return () => {
      doc.removeEventListener('input', handleInput);
      observer.disconnect();
    };
  }, [planId]); // Do not add plan.content to dependencies to avoid re-rendering on every keystroke

  // Paper Size Styles
  let paperStyle: React.CSSProperties = {};
  switch (paperSize) {
    case 'f4': paperStyle = { minHeight: '330.2mm', width: '215.9mm' }; break;
    case 'letter': paperStyle = { minHeight: '279.4mm', width: '215.9mm' }; break;
    case 'legal': paperStyle = { minHeight: '355.6mm', width: '215.9mm' }; break;
    case 'a4':
    default: paperStyle = { minHeight: '297mm', width: '210mm' }; break;
  }

  const exec = (command: string, value?: string) => {
    iframeRef.current?.contentDocument?.execCommand(command, false, value);
  };

  const handleMagicPaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      const cleanedText = text.replace(/```html/g, '').replace(/```/g, '').trim();
      
      const doc = iframeRef.current?.contentDocument;
      if (doc) {
        // Rewrite entire document if it looks like a full HTML page
        if (cleanedText.includes('<html')) {
          doc.open();
          doc.write(cleanedText);
          doc.close();
          doc.designMode = 'on';
          updatePlan(planId, doc.documentElement.outerHTML);
        } else {
          // Otherwise just paste at cursor
          exec('insertHTML', cleanedText);
        }
      }
    } catch (err) {
      console.error('Clipboard failed', err);
      alert('Gagal membaca clipboard.');
    }
  };

  return (
    <div className="flex flex-col h-full items-center w-full">
      {/* Toolbar */}
      <div className="sticky top-0 z-10 bg-white border-b border-gray-200 p-2 flex flex-wrap gap-2 w-full justify-center shadow-sm">
        <button onClick={() => exec('bold')} className="p-2 rounded hover:bg-gray-100 text-gray-700" title="Bold">
          <Bold className="w-5 h-5" />
        </button>
        <button onClick={() => exec('italic')} className="p-2 rounded hover:bg-gray-100 text-gray-700" title="Italic">
          <Italic className="w-5 h-5" />
        </button>
        <button onClick={() => exec('underline')} className="p-2 rounded hover:bg-gray-100 text-gray-700" title="Underline">
          <UnderlineIcon className="w-5 h-5" />
        </button>
        <div className="w-px h-6 bg-gray-300 self-center mx-1"></div>
        <button onClick={() => exec('insertUnorderedList')} className="p-2 rounded hover:bg-gray-100 text-gray-700" title="Bullet List">
          <List className="w-5 h-5" />
        </button>
        <button onClick={() => exec('insertOrderedList')} className="p-2 rounded hover:bg-gray-100 text-gray-700" title="Ordered List">
          <ListOrdered className="w-5 h-5" />
        </button>
        <div className="w-px h-6 bg-gray-300 self-center mx-1"></div>
        <button onClick={() => exec('undo')} className="p-2 rounded hover:bg-gray-100 text-gray-700" title="Undo">
          <Undo className="w-5 h-5" />
        </button>
        <button onClick={() => exec('redo')} className="p-2 rounded hover:bg-gray-100 text-gray-700" title="Redo">
          <Redo className="w-5 h-5" />
        </button>
        <div className="w-px h-6 bg-gray-300 self-center mx-1"></div>
        <button onClick={handleMagicPaste} className="flex items-center gap-2 p-2 px-3 rounded hover:bg-purple-100 text-purple-700 font-medium" title="Paste HTML bersih">
          <Wand2 className="w-5 h-5" />
          <span>Magic Paste</span>
        </button>
      </div>

      {/* Editor Area */}
      <div className="w-full bg-[#e5e7eb] overflow-y-auto pb-20 pt-4 flex-1">
          <div className="mx-auto bg-white shadow-lg flex flex-col" style={{ ...paperStyle, padding: 0 }} id="print-content">
             <iframe 
               ref={iframeRef} 
               style={{ width: '100%', flex: '1 1 auto', border: 'none', display: 'block', minHeight: paperStyle.minHeight }} 
               title="Editor"
             />
          </div>
      </div>
    </div>
  );
};
