
import { useStore } from './store';
import { Dashboard } from './components/Dashboard';
import { EditorPage } from './components/EditorPage';

function App() {
  const currentPlanId = useStore((state) => state.currentPlanId);

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 font-sans">
      {currentPlanId ? <EditorPage /> : <Dashboard />}
    </div>
  );
}

export default App;
