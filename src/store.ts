import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { v4 as uuidv4 } from 'uuid';

export interface LessonPlan {
  id: string;
  title: string;
  content: string; // HTML content
  createdAt: number;
  updatedAt: number;
}

interface AppState {
  plans: LessonPlan[];
  currentPlanId: string | null;
  paperSize: string;
  setPaperSize: (size: string) => void;
  setCurrentPlanId: (id: string | null) => void;
  createPlan: (title: string, content?: string) => string;
  updatePlan: (id: string, content: string, title?: string) => void;
  deletePlan: (id: string) => void;
  duplicatePlan: (id: string) => string;
}

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      plans: [],
      currentPlanId: null,
      paperSize: 'a4',

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
      name: 'lesson-plan-storage', // name of item in the storage (must be unique)
    }
  )
);
