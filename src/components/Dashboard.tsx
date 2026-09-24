import React, { useRef, useState } from 'react';
import { useStore, useSaveStatus, STORAGE_LIMIT_CHARS } from '../store';
import { downloadBackup, parseBackup } from '../backup';
import { FileText, Plus, Trash2, Copy, Edit2, Download, Upload, HardDrive } from 'lucide-react';

const BACKUP_REMINDER_MS = 7 * 24 * 60 * 60 * 1000;

const formatDate = (time: number) =>
  new Date(time).toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

export const Dashboard: React.FC = () => {
  const { plans, createPlan, deletePlan, duplicatePlan, setCurrentPlanId, lastBackupAt, setLastBackupAt, importPlans } = useStore();
  const usedChars = useSaveStatus((s) => s.usedChars);
  const [newTitle, setNewTitle] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [openedAt] = useState(() => Date.now());

  const usedPercent = Math.min(100, Math.round((usedChars / STORAGE_LIMIT_CHARS) * 100));
  const needsBackup = plans.length > 0 && (!lastBackupAt || openedAt - lastBackupAt > BACKUP_REMINDER_MS);

  const handleBackup = () => {
    downloadBackup(plans);
    setLastBackupAt(Date.now());
  };

  const handleRestore = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow choosing the same file again
    if (!file) return;
    try {
      const incoming = parseBackup(await file.text());
      if (!window.confirm(
        `Pulihkan ${incoming.length} dokumen dari "${file.name}"?\n\n` +
        'Dokumen baru akan ditambahkan. Dokumen yang sudah ada hanya diganti jika versi di backup lebih baru.'
      )) return;
      const { added, updated, skipped } = importPlans(incoming);
      alert(`Pemulihan selesai.\n${added} ditambahkan, ${updated} diperbarui, ${skipped} dilewati (versi di perangkat ini sama atau lebih baru).`);
    } catch (err) {
      alert(`Gagal memulihkan backup: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (newTitle.trim()) {
      createPlan(newTitle.trim());
      setNewTitle('');
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-6">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-800">Lesson Plan Studio</h1>
          <p className="text-gray-600">Kelola dan edit RPP Anda dengan mudah</p>
        </div>
      </header>

      <div className={`rounded-lg p-4 mb-6 border flex flex-wrap items-center gap-4 ${needsBackup ? 'bg-amber-50 border-amber-300' : 'bg-white border-gray-200'}`}>
        <div className="flex-1 min-w-60">
          <div className="flex items-center text-sm font-medium text-gray-700">
            <HardDrive className="h-4 w-4 mr-2 text-gray-500" />
            Penyimpanan browser: {(usedChars / 1_000_000).toFixed(2)} MB dari ±5 MB ({usedPercent}%)
          </div>
          <div className="h-1.5 bg-gray-200 rounded mt-2 overflow-hidden">
            <div
              className={`h-full ${usedPercent >= 80 ? 'bg-red-500' : 'bg-blue-500'}`}
              style={{ width: `${usedPercent}%` }}
            />
          </div>
          <p className={`text-xs mt-2 ${needsBackup ? 'text-amber-800 font-medium' : 'text-gray-500'}`}>
            {lastBackupAt ? `Backup terakhir: ${formatDate(lastBackupAt)}.` : 'Belum pernah backup.'}
            {needsBackup && ' Dokumen hanya tersimpan di browser ini — unduh backup secara berkala.'}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleBackup}
            disabled={plans.length === 0}
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 rounded-md"
          >
            <Download className="h-4 w-4" /> Unduh Backup
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 bg-white hover:bg-gray-100 border border-gray-300 rounded-md"
          >
            <Upload className="h-4 w-4" /> Pulihkan Backup
          </button>
          <input ref={fileInputRef} type="file" accept=".json,application/json" onChange={handleRestore} className="hidden" />
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm p-6 mb-8 border border-gray-200">
        <h2 className="text-lg font-semibold mb-4 flex items-center">
          <Plus className="mr-2 h-5 w-5 text-blue-600" />
          Buat Rencana Pembelajaran Baru
        </h2>
        <form onSubmit={handleCreate} className="flex gap-4">
          <input
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Contoh: Biologi Kelas 10 - Fotosintesis"
            className="flex-1 border border-gray-300 rounded-md px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="submit"
            disabled={!newTitle.trim()}
            className="bg-blue-600 text-white px-6 py-2 rounded-md hover:bg-blue-700 disabled:bg-blue-300 transition-colors"
          >
            Buat
          </button>
        </form>
      </div>

      <div className="grid gap-4">
        {plans.length === 0 ? (
          <div className="text-center py-12 text-gray-500 bg-white rounded-lg border border-gray-200 border-dashed">
            Belum ada dokumen. Buat dokumen pertama Anda di atas.
          </div>
        ) : (
          [...plans].sort((a, b) => b.updatedAt - a.updatedAt).map((plan) => (
            <div
              key={plan.id}
              className="bg-white rounded-lg p-5 border border-gray-200 hover:shadow-md transition-shadow flex items-center justify-between group"
            >
              <div
                className="flex items-center flex-1 cursor-pointer"
                onClick={() => setCurrentPlanId(plan.id)}
              >
                <div className="h-10 w-10 bg-blue-50 rounded-lg flex items-center justify-center mr-4">
                  <FileText className="text-blue-600 h-6 w-6" />
                </div>
                <div>
                  <h3 className="font-semibold text-lg text-gray-800 group-hover:text-blue-600 transition-colors">
                    {plan.title}
                  </h3>
                  <p className="text-sm text-gray-500">
                    Terakhir diubah: {formatDate(plan.updatedAt)}
                  </p>
                </div>
              </div>
              <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => setCurrentPlanId(plan.id)}
                  className="p-2 text-gray-600 hover:text-blue-600 hover:bg-blue-50 rounded-md"
                  title="Edit"
                >
                  <Edit2 className="h-5 w-5" />
                </button>
                <button
                  onClick={() => duplicatePlan(plan.id)}
                  className="p-2 text-gray-600 hover:text-green-600 hover:bg-green-50 rounded-md"
                  title="Duplikat"
                >
                  <Copy className="h-5 w-5" />
                </button>
                <button
                  onClick={() => {
                    if (window.confirm('Yakin ingin menghapus dokumen ini?')) {
                      deletePlan(plan.id);
                    }
                  }}
                  className="p-2 text-gray-600 hover:text-red-600 hover:bg-red-50 rounded-md"
                  title="Hapus"
                >
                  <Trash2 className="h-5 w-5" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
