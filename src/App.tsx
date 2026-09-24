import { useStore, useSaveStatus } from './store';
import { downloadBackup } from './backup';
import { Dashboard } from './components/Dashboard';
import { EditorPage } from './components/EditorPage';

function SaveErrorBanner() {
  const error = useSaveStatus((s) => s.error);
  if (!error) return null;

  // The in-memory state still holds the latest edits, so a backup rescues them
  // even though localStorage rejected the write.
  const handleRescue = () => {
    const { plans, setLastBackupAt } = useStore.getState();
    downloadBackup(plans);
    setLastBackupAt(Date.now());
  };

  return (
    <div role="alert" className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 w-[min(640px,calc(100%-32px))] bg-red-600 text-white rounded-lg shadow-xl p-4 flex flex-wrap items-center gap-3">
      <div className="flex-1 min-w-60 text-sm">
        <p className="font-semibold">{error}</p>
        <p className="opacity-90">Unduh backup sekarang agar pekerjaan tidak hilang, lalu hapus dokumen lama atau gambar besar untuk mengosongkan ruang.</p>
      </div>
      <button onClick={handleRescue} className="bg-white text-red-700 font-semibold text-sm px-4 py-2 rounded-md hover:bg-red-50">
        Unduh Backup
      </button>
    </div>
  );
}

function App() {
  const currentPlanId = useStore((state) => state.currentPlanId);

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 font-sans">
      {currentPlanId ? <EditorPage /> : <Dashboard />}
      <SaveErrorBanner />
    </div>
  );
}

export default App;
