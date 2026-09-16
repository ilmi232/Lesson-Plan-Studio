import React, { useEffect, useRef } from 'react';
import { useStore } from '../store';
import { Bold, Italic, Underline as UnderlineIcon, List, ListOrdered, Undo, Redo, Wand2, Scissors } from 'lucide-react';

interface IframeEditorProps {
  planId: string;
}

export const IframeEditor: React.FC<IframeEditorProps> = ({ planId }) => {
  const { plans, updatePlan, paperSize } = useStore();
  const plan = plans.find((p) => p.id === planId);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Setup function to attach listeners and observers (can be called on mount and after magic paste)
  const setupIframe = (doc: Document) => {
    doc.designMode = 'on';

    const pageBreakStyle = `
      .page-break {
        display: block !important; height: 24px !important; background-color: #f3f4f6 !important;
        border-top: 2px dashed #9ca3af !important; border-bottom: 2px dashed #9ca3af !important;
        margin: 20px 0 !important; text-align: center !important; color: #6b7280 !important;
        font-size: 12px !important; font-weight: bold !important; line-height: 20px !important;
        page-break-after: always !important; user-select: none;
      }
      .page-break::before { content: "📄 BATAS HALAMAN (Teks setelah ini akan pindah ke halaman baru saat PDF/Print)"; }
      @media print {
        .page-break { height: 0 !important; border: none !important; background: transparent !important; color: transparent !important; margin: 0 !important; }
        .page-break::before { content: ""; }
      }
    `;

    // Inject hidden scrollbar CSS if not present
    if (!doc.querySelector('#iframe-custom-style')) {
      const style = doc.createElement('style');
      style.id = 'iframe-custom-style';
      style.innerHTML = 'html, body { overflow-y: hidden !important; } ' + pageBreakStyle;
      doc.head?.appendChild(style);
    }

    // --- TABLE RESIZER PLUGIN ---
    if (!(doc as any)._hasTableResizer) {
      let isResizingCol = false;
      let isResizingRow = false;
      let currentCell: HTMLElement | null = null;
      let resizeMode: 'col' | 'row' | null = null;
      let startX = 0;
      let startY = 0;

      const getCols = (table: HTMLTableElement) => {
        let colgroup = table.querySelector('colgroup');
        if (!colgroup) {
          colgroup = doc.createElement('colgroup');
          let maxCols = 0;
          let templateRow = null;
          for (let i = 0; i < table.rows.length; i++) {
             let cols = 0;
             for (let j = 0; j < table.rows[i].cells.length; j++) {
               cols += table.rows[i].cells[j].colSpan || 1;
             }
             if (cols > maxCols) {
               maxCols = cols;
               templateRow = table.rows[i];
             }
          }
          for (let i = 0; i < maxCols; i++) {
             colgroup.appendChild(doc.createElement('col'));
          }
          if (templateRow) {
             let colIdx = 0;
             for (let i = 0; i < templateRow.cells.length; i++) {
                const c = templateRow.cells[i];
                const span = c.colSpan || 1;
                const w = parseInt(doc.defaultView?.getComputedStyle(c).width || '0', 10) / span;
                for (let s = 0; s < span; s++) {
                   const col = colgroup.children[colIdx] as HTMLElement;
                   if (col) col.style.width = w + 'px';
                   colIdx++;
                }
             }
          }
          table.insertBefore(colgroup, table.firstChild);
        }
        return Array.from(colgroup.querySelectorAll('col'));
      };

      doc.addEventListener('mousemove', (e) => {
        if (isResizingCol && (doc as any)._resizeCols) {
          const dx = e.clientX - startX;
          const state = (doc as any)._resizeCols;
          if (state.leftCol) {
            state.leftCol.style.width = `${Math.max(20, state.startWidth + dx)}px`;
          }
          if (state.rightCol) {
            state.rightCol.style.width = `${Math.max(20, state.startNextWidth - dx)}px`;
          }
          return;
        }
        
        if (isResizingRow && (doc as any)._resizeRow) {
          const dy = e.clientY - startY;
          const state = (doc as any)._resizeRow;
          const newHeight = Math.max(20, state.startHeight + dy);
          state.row.style.height = `${newHeight}px`;
          if (state.cell) {
             state.cell.style.height = `${newHeight}px`;
          }
          return;
        }

        const target = e.target as HTMLElement;
        if (target && (target.tagName === 'TD' || target.tagName === 'TH')) {
          const rect = target.getBoundingClientRect();
          const nearRight = e.clientX > rect.right - 10 && e.clientX <= rect.right;
          const nearBottom = e.clientY > rect.bottom - 10 && e.clientY <= rect.bottom;
          const nearLeft = e.clientX < rect.left + 10 && e.clientX >= rect.left;
          
          if (nearRight && nearBottom) {
            target.style.cursor = 'nwse-resize';
            currentCell = target;
            resizeMode = 'both'; // Actually, let's just make it col-resize for simplicity or handle both? Let's just handle them separately. Wait, we can't do both simultaneously easily. Let's just default to row-resize in the corner since columns are easier to hit.
            target.style.cursor = 'row-resize';
            resizeMode = 'row';
          } else if (nearRight) {
            target.style.cursor = 'col-resize';
            currentCell = target;
            resizeMode = 'col';
          } else if (nearBottom) {
            target.style.cursor = 'row-resize';
            currentCell = target;
            resizeMode = 'row';
          } else if (nearLeft) {
            const prev = target.previousElementSibling as HTMLElement;
            if (prev) {
              target.style.cursor = 'col-resize';
              currentCell = prev;
              resizeMode = 'col';
            } else {
              target.style.cursor = 'text';
              currentCell = null;
              resizeMode = null;
            }
          } else {
            target.style.cursor = 'text';
            currentCell = null;
            resizeMode = null;
          }
        } else if (currentCell && !isResizingCol && !isResizingRow) {
          currentCell.style.cursor = 'text';
          currentCell = null;
          resizeMode = null;
        }
      });

      doc.addEventListener('mousedown', (e) => {
        if (currentCell && resizeMode) {
          const table = currentCell.closest('table');
          if (!table) return;
          
          if (resizeMode === 'col') {
            const cols = getCols(table);
            let colIndex = 0;
            const row = currentCell.parentElement as HTMLTableRowElement;
            for (let i = 0; i < row.cells.length; i++) {
               if (row.cells[i] === currentCell) break;
               colIndex += row.cells[i].colSpan || 1;
            }
            
            const currentCellSpan = (currentCell as HTMLTableCellElement).colSpan || 1;
            const leftColIdx = colIndex + currentCellSpan - 1;
            const rightColIdx = leftColIdx + 1;
            
            const leftCol = cols[leftColIdx] as HTMLElement;
            const rightCol = cols[rightColIdx] as HTMLElement;
            
            if (leftCol) {
              isResizingCol = true;
              startX = e.clientX;
              const getWidth = (col: HTMLElement) => parseInt(col.style.width || doc.defaultView?.getComputedStyle(col).width || '0', 10);
              (doc as any)._resizeCols = {
                 leftCol,
                 rightCol,
                 startWidth: getWidth(leftCol),
                 startNextWidth: rightCol ? getWidth(rightCol) : 0
              };
              table.style.tableLayout = 'fixed';
              e.preventDefault();
            }
          } else if (resizeMode === 'row') {
            isResizingRow = true;
            startY = e.clientY;
            const row = currentCell.parentElement as HTMLTableRowElement;
            const getHeight = (el: HTMLElement) => parseInt(el.style.height || doc.defaultView?.getComputedStyle(el).height || '0', 10);
            
            (doc as any)._resizeRow = {
               row,
               cell: currentCell,
               startHeight: getHeight(row) || getHeight(currentCell)
            };
            e.preventDefault();
          }
        }
      });

      doc.addEventListener('mouseup', () => {
        if (isResizingCol || isResizingRow) {
          isResizingCol = false;
          isResizingRow = false;
          currentCell = null;
          resizeMode = null;
          (doc as any)._resizeCols = null;
          (doc as any)._resizeRow = null;
          doc.dispatchEvent(new Event('input', { bubbles: true }));
        }
      });

      (doc as any)._hasTableResizer = true;
    }
    // --- END TABLE RESIZER ---

    const adjustHeight = () => {
      if (iframeRef.current && doc.body) {
        iframeRef.current.style.height = '10px'; // Reset to force shrink if needed
        const newHeight = Math.max(doc.body.scrollHeight, doc.documentElement.scrollHeight);
        iframeRef.current.style.height = `${newHeight + 50}px`; // Add padding bottom
      }
    };

    const handleInput = () => {
      updatePlan(planId, doc.documentElement.outerHTML);
      adjustHeight();
    };

    // Remove old listeners if any exist (to prevent duplicates if called multiple times)
    // @ts-ignore
    if (doc._hasAttachedListeners) {
      // It's hard to remove anonymous functions, so we rely on the fact that doc.write wipes them out,
      // and we only call setupIframe after doc.write or on fresh mount.
    }
    
    doc.addEventListener('input', handleInput);
    // @ts-ignore
    doc._hasAttachedListeners = true;
    
    // Auto-resize on initial load and when images/mathjax load
    setTimeout(adjustHeight, 100);
    setTimeout(adjustHeight, 1000); 
    setTimeout(adjustHeight, 3000);

    const observer = new MutationObserver(adjustHeight);
    observer.observe(doc.body, { childList: true, subtree: true, characterData: true, attributes: true });
    
    return { handleInput, observer };
  };

  // Initialize the iframe document
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !plan) return;

    const doc = iframe.contentDocument;
    if (!doc) return;

    // Only set content if the iframe is empty (to preserve cursor/focus during typing)
    if (doc.body && doc.body.innerHTML.length > 0) return;

    let content = plan.content;
    
    const pageBreakStyle = `
      .page-break {
        display: block !important; height: 24px !important; background-color: #f3f4f6 !important;
        border-top: 2px dashed #9ca3af !important; border-bottom: 2px dashed #9ca3af !important;
        margin: 20px 0 !important; text-align: center !important; color: #6b7280 !important;
        font-size: 12px !important; font-weight: bold !important; line-height: 20px !important;
        page-break-after: always !important; user-select: none;
      }
      .page-break::before { content: "📄 BATAS HALAMAN (Teks setelah ini akan pindah ke halaman baru saat PDF/Print)"; }
      @media print {
        .page-break { height: 0 !important; border: none !important; background: transparent !important; color: transparent !important; margin: 0 !important; }
        .page-break::before { content: ""; }
      }
    `;

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
       <style id="iframe-custom-style">html, body { overflow-y: hidden !important; } ${pageBreakStyle}</style>
       </head><body>${content}</body></html>`;
    } else {
       // Make sure old content has the hidden scrollbar
       if (!content.includes('iframe-custom-style')) {
         content = content.replace('</head>', `<style id="iframe-custom-style">html, body { overflow-y: hidden !important; } ${pageBreakStyle}</style></head>`);
       }
    }

    doc.open();
    doc.write(content);
    doc.close();

    const { handleInput, observer } = setupIframe(doc);

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
          
          updatePlan(planId, doc.documentElement.outerHTML);
          
          setupIframe(doc);
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

  const handleInsertPageBreak = () => {
    const html = '<div class="page-break"></div><p><br></p>';
    exec('insertHTML', html);
  };

  const getSelectedCell = () => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc) return null;
    const selection = doc.getSelection();
    if (!selection || selection.rangeCount === 0) return null;
    let node: any = selection.anchorNode;
    while (node && node.nodeName !== 'TD' && node.nodeName !== 'TH' && node.nodeName !== 'BODY') {
      node = node.parentNode;
    }
    return (node && (node.nodeName === 'TD' || node.nodeName === 'TH')) ? node : null;
  };

  const handleTableAction = (action: string) => {
    const cell = getSelectedCell();
    if (!cell) return alert('Klik di dalam tabel terlebih dahulu!');
    const row = cell.parentNode as HTMLTableRowElement;
    const table = cell.closest('table') as HTMLTableElement;
    const cellIndex = Array.prototype.indexOf.call(row.children, cell);
    
    if (action === 'addRow') {
      const newRow = row.cloneNode(true) as HTMLTableRowElement;
      Array.from(newRow.cells).forEach(c => c.innerHTML = '');
      row.parentNode?.insertBefore(newRow, row.nextSibling);
    } else if (action === 'delRow') {
      row.parentNode?.removeChild(row);
    } else if (action === 'addCol') {
      Array.from(table.rows).forEach(r => {
        const newCell = r.cells[cellIndex].cloneNode(true) as HTMLTableCellElement;
        newCell.innerHTML = '';
        r.insertBefore(newCell, r.cells[cellIndex].nextSibling);
      });
    } else if (action === 'delCol') {
      Array.from(table.rows).forEach(r => {
        if (r.cells[cellIndex]) r.removeChild(r.cells[cellIndex]);
      });
    } else if (action === 'delTable') {
      table.parentNode?.removeChild(table);
    }
    iframeRef.current?.contentDocument?.dispatchEvent(new Event('input', { bubbles: true }));
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
        
        {/* Table tools */}
        <div className="flex items-center text-xs font-medium text-gray-500 bg-gray-50 rounded border border-gray-200 overflow-hidden">
          <button onClick={() => handleTableAction('addCol')} className="p-1.5 px-2 hover:bg-gray-200 hover:text-gray-800" title="Tambah Kolom (+Col)">+Col</button>
          <div className="w-px h-4 bg-gray-300"></div>
          <button onClick={() => handleTableAction('addRow')} className="p-1.5 px-2 hover:bg-gray-200 hover:text-gray-800" title="Tambah Baris (+Row)">+Row</button>
          <div className="w-px h-4 bg-gray-300"></div>
          <button onClick={() => handleTableAction('delCol')} className="p-1.5 px-2 hover:bg-red-100 text-red-600" title="Hapus Kolom">-Col</button>
          <div className="w-px h-4 bg-gray-300"></div>
          <button onClick={() => handleTableAction('delRow')} className="p-1.5 px-2 hover:bg-red-100 text-red-600" title="Hapus Baris">-Row</button>
          <div className="w-px h-4 bg-gray-300"></div>
          <button onClick={() => handleTableAction('delTable')} className="p-1.5 px-2 hover:bg-red-100 text-red-600" title="Hapus Tabel">Del Table</button>
        </div>

        <div className="w-px h-6 bg-gray-300 self-center mx-1"></div>
        <button onClick={handleInsertPageBreak} className="flex items-center gap-2 p-2 px-3 rounded hover:bg-orange-100 text-orange-700 font-medium" title="Batas Halaman (Page Break)">
          <Scissors className="w-5 h-5" />
          <span>Batas Halaman</span>
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
