import React, { useEffect } from 'react';
import { Check, X, AlertTriangle } from 'lucide-react';
import type { RestructureResult } from '../restructure';

interface Props {
  beforeHtml: string;
  result: RestructureResult;
  afterHtml: string;
  onApply: () => void;
  onCancel: () => void;
}

// Sandboxed without allow-same-origin: Tailwind/MathJax still run, but in an opaque origin
// that cannot reach the app's localStorage.
const Pane: React.FC<{ title: string; html: string }> = ({ title, html }) => (
  <div className="flex-1 min-w-0 flex flex-col">
    <div className="text-sm font-semibold text-gray-700 mb-2">{title}</div>
    <iframe
      srcDoc={html}
      sandbox="allow-scripts"
      title={title}
      className="flex-1 w-full bg-white border border-gray-300 rounded shadow-inner"
    />
  </div>
);

export const RestructurePreview: React.FC<Props> = ({ beforeHtml, result, afterHtml, onApply, onCancel }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const total = result.parts.length;
  const kept = result.parts
    .map((p, i) => ({ ...p, n: i + 1 }))
    .filter((p) => p.status === 'kept');

  return (
    <div className="fixed inset-0 z-40 bg-black/50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="bg-gray-50 rounded-lg shadow-2xl w-full max-w-7xl h-full max-h-[95vh] flex flex-col p-4 gap-3">
        <div>
          <h2 className="text-lg font-bold text-gray-800">Pratinjau Rapikan Dokumen (AI)</h2>
          <p className="text-sm text-gray-600">
            {total - kept.length} dari {total} bagian dirapikan. Isi teks sudah diperiksa otomatis kata per kata.
            Periksa hasilnya sebelum menerapkan — versi lama tetap bisa dikembalikan dari toolbar.
          </p>
          {kept.length > 0 && (
            <div className="mt-2 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded p-2 flex gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                {kept.length} bagian dibiarkan seperti aslinya:
                <ul className="list-disc ml-5">
                  {kept.map((p) => <li key={p.n}>Bagian {p.n}: {p.reason}</li>)}
                </ul>
              </div>
            </div>
          )}
        </div>
        <div className="flex-1 min-h-0 flex gap-4">
          <Pane title="Sebelum" html={beforeHtml} />
          <Pane title="Sesudah" html={afterHtml} />
        </div>
        <div className="flex justify-end gap-3">
          <button onClick={onCancel} className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-100">
            <X className="w-4 h-4" /> Batalkan
          </button>
          <button
            onClick={onApply}
            disabled={kept.length === total}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-emerald-600 rounded-md hover:bg-emerald-700 disabled:bg-emerald-300"
          >
            <Check className="w-4 h-4" /> Terapkan
          </button>
        </div>
      </div>
    </div>
  );
};
