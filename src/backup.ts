import type { LessonPlan } from './store';

const BACKUP_APP = 'lesson-plan-studio';
const BACKUP_VERSION = 1;

interface BackupFile {
  app: string;
  version: number;
  exportedAt: number;
  plans: LessonPlan[];
}

export function downloadBackup(plans: LessonPlan[]) {
  const backup: BackupFile = {
    app: BACKUP_APP,
    version: BACKUP_VERSION,
    exportedAt: Date.now(),
    plans,
  };
  const date = new Date().toISOString().slice(0, 10);
  const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `backup-rpp-${date}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function isLessonPlan(value: unknown): value is LessonPlan {
  const p = value as LessonPlan;
  return (
    typeof p === 'object' && p !== null &&
    typeof p.id === 'string' && p.id.length > 0 &&
    typeof p.title === 'string' &&
    typeof p.content === 'string' &&
    typeof p.createdAt === 'number' &&
    typeof p.updatedAt === 'number'
  );
}

// Throws an Error with a user-facing (Indonesian) message when the file is not a valid backup.
export function parseBackup(text: string): LessonPlan[] {
  let data: BackupFile;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('File bukan JSON yang valid.');
  }
  if (data?.app !== BACKUP_APP || !Array.isArray(data.plans)) {
    throw new Error('File ini bukan backup Lesson Plan Studio.');
  }
  if (data.version > BACKUP_VERSION) {
    throw new Error('Backup dibuat oleh versi aplikasi yang lebih baru.');
  }
  const plans = data.plans.filter(isLessonPlan);
  if (plans.length !== data.plans.length) {
    throw new Error('Sebagian dokumen di backup rusak atau tidak lengkap.');
  }
  return plans;
}
