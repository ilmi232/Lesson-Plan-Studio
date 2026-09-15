import React, { useState } from 'react';
import { useStore } from '../store';
import { FileText, Plus, Trash2, Copy, Edit2 } from 'lucide-react';

export const Dashboard: React.FC = () => {
  const { plans, createPlan, deletePlan, duplicatePlan, setCurrentPlanId } = useStore();
  const [newTitle, setNewTitle] = useState('');

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
          plans.sort((a, b) => b.updatedAt - a.updatedAt).map((plan) => (
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
                    Terakhir diubah: {new Date(plan.updatedAt).toLocaleDateString('id-ID', {
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
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
