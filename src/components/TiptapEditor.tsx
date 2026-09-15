import React, { useEffect } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { StarterKit } from '@tiptap/starter-kit';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { Underline } from '@tiptap/extension-underline';
import { useStore } from '../store';
import { Bold, Italic, Underline as UnderlineIcon, List, ListOrdered, Undo, Redo, Wand2 } from 'lucide-react';

interface TiptapEditorProps {
  planId: string;
}

export const TiptapEditor: React.FC<TiptapEditorProps> = ({ planId }) => {
  const { plans, updatePlan, paperSize } = useStore();
  const plan = plans.find((p) => p.id === planId);

  // Define paper dimensions
  let paperStyle = '';
  switch (paperSize) {
    case 'f4':
      paperStyle = 'min-height: 330.2mm; width: 215.9mm;';
      break;
    case 'letter':
      paperStyle = 'min-height: 279.4mm; width: 215.9mm;';
      break;
    case 'legal':
      paperStyle = 'min-height: 355.6mm; width: 215.9mm;';
      break;
    case 'a4':
    default:
      paperStyle = 'min-height: 297mm; width: 210mm;';
      break;
  }

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Table.configure({
        resizable: true,
      }),
      TableRow,
      TableHeader,
      TableCell,
    ],
    content: plan?.content || '',
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      updatePlan(planId, html);
    },
    editorProps: {
      attributes: {
        class: 'prose prose-sm sm:prose lg:prose-lg xl:prose-xl focus:outline-none max-w-none mx-auto bg-white shadow-lg p-12 mt-8 mb-12',
        style: paperStyle,
      },
    },
  }, [paperSize]);

  useEffect(() => {
    if (editor && plan?.content && editor.getHTML() !== plan.content) {
      // update content if it changes externally
      // editor.commands.setContent(plan.content);
    }
  }, [planId, editor]);

  if (!editor || !plan) {
    return null;
  }

  // Magic Paste Handler
  const handleMagicPaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      // Remove markdown code blocks if they exist
      const cleanedText = text
        .replace(/```html/g, '')
        .replace(/```/g, '')
        .trim();
      
      // We can use setContent to completely replace or insertContent to insert at cursor
      editor.commands.setContent(cleanedText);
    } catch (err) {
      console.error('Failed to read clipboard contents: ', err);
      alert('Gagal membaca dari clipboard. Pastikan Anda telah mengizinkan akses clipboard.');
    }
  };

  return (
    <div className="flex flex-col h-full items-center w-full">
      <div className="sticky top-0 z-10 bg-white border-b border-gray-200 p-2 flex flex-wrap gap-2 w-full justify-center shadow-sm">
        <button
          onClick={() => editor.chain().focus().toggleBold().run()}
          className={`p-2 rounded hover:bg-gray-100 ${editor.isActive('bold') ? 'bg-gray-200 text-blue-600' : 'text-gray-700'}`}
          title="Bold"
        >
          <Bold className="w-5 h-5" />
        </button>
        <button
          onClick={() => editor.chain().focus().toggleItalic().run()}
          className={`p-2 rounded hover:bg-gray-100 ${editor.isActive('italic') ? 'bg-gray-200 text-blue-600' : 'text-gray-700'}`}
          title="Italic"
        >
          <Italic className="w-5 h-5" />
        </button>
        <button
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          className={`p-2 rounded hover:bg-gray-100 ${editor.isActive('underline') ? 'bg-gray-200 text-blue-600' : 'text-gray-700'}`}
          title="Underline"
        >
          <UnderlineIcon className="w-5 h-5" />
        </button>
        <div className="w-px h-6 bg-gray-300 self-center mx-1"></div>
        <button
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          className={`p-2 rounded hover:bg-gray-100 ${editor.isActive('bulletList') ? 'bg-gray-200 text-blue-600' : 'text-gray-700'}`}
          title="Bullet List"
        >
          <List className="w-5 h-5" />
        </button>
        <button
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          className={`p-2 rounded hover:bg-gray-100 ${editor.isActive('orderedList') ? 'bg-gray-200 text-blue-600' : 'text-gray-700'}`}
          title="Ordered List"
        >
          <ListOrdered className="w-5 h-5" />
        </button>
        <div className="w-px h-6 bg-gray-300 self-center mx-1"></div>
        <button
          onClick={() => editor.chain().focus().undo().run()}
          disabled={!editor.can().undo()}
          className="p-2 rounded hover:bg-gray-100 text-gray-700 disabled:opacity-50"
          title="Undo"
        >
          <Undo className="w-5 h-5" />
        </button>
        <button
          onClick={() => editor.chain().focus().redo().run()}
          disabled={!editor.can().redo()}
          className="p-2 rounded hover:bg-gray-100 text-gray-700 disabled:opacity-50"
          title="Redo"
        >
          <Redo className="w-5 h-5" />
        </button>
        <div className="w-px h-6 bg-gray-300 self-center mx-1"></div>
        <button
          onClick={handleMagicPaste}
          className="flex items-center gap-2 p-2 px-3 rounded hover:bg-purple-100 text-purple-700 font-medium"
          title="Paste teks dari AI, otomatis menghapus format markdown yang rusak"
        >
          <Wand2 className="w-5 h-5" />
          <span>Magic Paste</span>
        </button>
        
        {/* Table Controls (Basic) */}
        <div className="flex gap-1 items-center ml-2 border-l pl-2 border-gray-300">
             <button onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} className="text-sm px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded">Insert Table</button>
             <button onClick={() => editor.chain().focus().addColumnBefore().run()} className="text-sm px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded" disabled={!editor.can().addColumnBefore()}>+Col</button>
             <button onClick={() => editor.chain().focus().addRowAfter().run()} className="text-sm px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded" disabled={!editor.can().addRowAfter()}>+Row</button>
             <button onClick={() => editor.chain().focus().deleteTable().run()} className="text-sm px-2 py-1 bg-red-50 text-red-600 hover:bg-red-100 rounded" disabled={!editor.can().deleteTable()}>Delete Table</button>
        </div>
      </div>

      <div className="w-full bg-[#e5e7eb] overflow-y-auto pb-20 pt-4 flex-1 document-editor-container">
          <EditorContent editor={editor} id="print-content" />
      </div>
    </div>
  );
};
