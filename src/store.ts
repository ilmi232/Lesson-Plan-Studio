import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { v4 as uuidv4 } from 'uuid';

export const STORAGE_KEY = 'lesson-plan-storage';
// Browsers allow roughly 5 million characters per origin in localStorage.
export const STORAGE_LIMIT_CHARS = 5_000_000;

export interface LessonPlan {
  id: string;
  title: string;
  content: string; // HTML content
  createdAt: number;
  updatedAt: number;
  // Content before the last whole-document replacement (AI restructure, Magic Paste), for undo
  previousVersion?: { content: string; savedAt: number; reason: string };
}

// Save status lives in its own store: updating it from inside the persist
// storage must not trigger another persist write.
interface SaveStatus {
  error: string | null;
  usedChars: number;
}

export const useSaveStatus = create<SaveStatus>()(() => ({
  error: null,
  usedChars: 0,
}));

const safeLocalStorage = {
  getItem: (name: string) => {
    const value = localStorage.getItem(name);
    useSaveStatus.setState({ usedChars: value?.length ?? 0 });
    return value;
  },
  setItem: (name: string, value: string) => {
    try {
      localStorage.setItem(name, value);
      useSaveStatus.setState({ error: null, usedChars: value.length });
    } catch (err) {
      const quota = err instanceof DOMException && err.name === 'QuotaExceededError';
      useSaveStatus.setState({
        error: quota
          ? 'Memori browser penuh — perubahan terakhir TIDAK tersimpan.'
          : `Gagal menyimpan: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  },
  removeItem: (name: string) => localStorage.removeItem(name),
};

export interface ImportResult {
  added: number;
  updated: number;
  skipped: number;
}

interface AppState {
  plans: LessonPlan[];
  currentPlanId: string | null;
  paperSize: string;
  // Editor view: separate paper sheets like Word, or one continuous page with guides
  sheetView: boolean;
  setSheetView: (on: boolean) => void;
  lastBackupAt: number | null;
  setLastBackupAt: (time: number) => void;
  importPlans: (plans: LessonPlan[]) => ImportResult;
  setPaperSize: (size: string) => void;
  setCurrentPlanId: (id: string | null) => void;
  createPlan: (title: string, content?: string) => string;
  updatePlan: (id: string, content: string, title?: string) => void;
  replaceContent: (id: string, content: string, reason: string) => void;
  restorePreviousVersion: (id: string) => string | null;
  deletePlan: (id: string) => void;
  duplicatePlan: (id: string) => string;
}

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      plans: [],
      currentPlanId: null,
      paperSize: 'a4',
      lastBackupAt: null,
      sheetView: true,

      setSheetView: (on) => set({ sheetView: on }),

      setLastBackupAt: (time) => set({ lastBackupAt: time }),

      // Merge by id: new plans are added, existing ones are replaced only if the backup copy is newer.
      importPlans: (incoming) => {
        const result: ImportResult = { added: 0, updated: 0, skipped: 0 };
        const byId = new Map(get().plans.map((p) => [p.id, p]));
        for (const plan of incoming) {
          const existing = byId.get(plan.id);
          if (!existing) {
            byId.set(plan.id, plan);
            result.added++;
          } else if (plan.updatedAt > existing.updatedAt) {
            byId.set(plan.id, plan);
            result.updated++;
          } else {
            result.skipped++;
          }
        }
        set({ plans: Array.from(byId.values()) });
        return result;
      },

      setPaperSize: (size) => set({ paperSize: size }),

      setCurrentPlanId: (id) => set({ currentPlanId: id }),

      createPlan: (title, content = '') => {
        const id = uuidv4();
        const newPlan: LessonPlan = {
          id,
          title,
          content,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        set((state) => ({
          plans: [...state.plans, newPlan],
          currentPlanId: id,
        }));
        return id;
      },

      replaceContent: (id, content, reason) => {
        set((state) => ({
          plans: state.plans.map((plan) =>
            plan.id === id
              ? { ...plan, content, updatedAt: Date.now(), previousVersion: { content: plan.content, savedAt: Date.now(), reason } }
              : plan
          ),
        }));
      },

      // Returns the restored content (null if there was no previous version)
      restorePreviousVersion: (id) => {
        const previous = get().plans.find((p) => p.id === id)?.previousVersion;
        if (!previous) return null;
        set((state) => ({
          plans: state.plans.map((plan) =>
            plan.id === id ? { ...plan, content: previous.content, updatedAt: Date.now(), previousVersion: undefined } : plan
          ),
        }));
        return previous.content;
      },

      updatePlan: (id, content, title) => {
        set((state) => ({
          plans: state.plans.map((plan) =>
            plan.id === id
              ? { ...plan, content, title: title ?? plan.title, updatedAt: Date.now() }
              : plan
          ),
        }));
      },

      deletePlan: (id) => {
        set((state) => ({
          plans: state.plans.filter((plan) => plan.id !== id),
          currentPlanId: state.currentPlanId === id ? null : state.currentPlanId,
        }));
      },

      duplicatePlan: (id) => {
        const state = get();
        const planToCopy = state.plans.find((p) => p.id === id);
        if (!planToCopy) return '';

        const newId = uuidv4();
        const newPlan: LessonPlan = {
          ...planToCopy,
          previousVersion: undefined,
          id: newId,
          title: `${planToCopy.title} (Copy)`,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };

        set((state) => ({
          plans: [...state.plans, newPlan],
        }));

        return newId;
      },
    }),
    {
      name: STORAGE_KEY, // name of item in the storage (must be unique)
      storage: createJSONStorage(() => safeLocalStorage),
    }
  )
);
