import { type Category, type Entry, normalizeCategories } from '../../shared/model';

/** Состояние формы: все текстовые поля — строки (пустая = не заполнено). */
export interface FormState {
  achievement: string;
  categories: Category[];
  obstacle: string;
  how: string;
  lesson: string;
  goal_tomorrow: string;
}

export const EMPTY_FORM: FormState = {
  achievement: '', categories: [], obstacle: '', how: '', lesson: '', goal_tomorrow: '',
};

export function formFromEntry(e: Entry | null): FormState {
  if (!e) return { ...EMPTY_FORM };
  return {
    achievement: e.achievement,
    categories: [...e.categories],
    obstacle: e.obstacle ?? '',
    how: e.how ?? '',
    lesson: e.lesson ?? '',
    goal_tomorrow: e.goal_tomorrow ?? '',
  };
}

export function sameForm(a: FormState, b: FormState): boolean {
  return (Object.keys(EMPTY_FORM) as (keyof FormState)[]).every((k) => String(a[k]) === String(b[k]));
}

const PREFIX = 'diary:draft:';

export function loadDraft(date: string): FormState | null {
  try {
    const raw = localStorage.getItem(PREFIX + date);
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<FormState> & { category?: unknown };
    const str = (v: unknown) => (typeof v === 'string' ? v : '');
    return {
      achievement: str(d.achievement),
      // d.category — черновик, сохранённый до появления множественного выбора
      categories: normalizeCategories(Array.isArray(d.categories) ? d.categories : [d.category]),
      obstacle: str(d.obstacle),
      how: str(d.how),
      lesson: str(d.lesson),
      goal_tomorrow: str(d.goal_tomorrow),
    };
  } catch {
    return null;
  }
}

export function saveDraft(date: string, form: FormState): void {
  try {
    localStorage.setItem(PREFIX + date, JSON.stringify(form));
  } catch { /* хранилище недоступно или переполнено */ }
}

export function clearDraft(date: string): void {
  try {
    localStorage.removeItem(PREFIX + date);
  } catch { /* ignore */ }
}

export function clearAllDrafts(): void {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key?.startsWith(PREFIX)) localStorage.removeItem(key);
    }
  } catch { /* ignore */ }
}
