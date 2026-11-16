/** Общие для сервера и клиента типы и константы. */

export const CATEGORIES = [
  'Карьера',
  'Здоровье',
  'Отношения',
  'Обучение',
  'Творчество',
  'Личное',
  'Финансы',
] as const;

export type Category = (typeof CATEGORIES)[number];

/** Содержимое записи — то, что вводит пользователь. */
export interface EntryFields {
  achievement: string;
  /** Ноль, одна или несколько категорий, в порядке списка CATEGORIES. */
  categories: Category[];
  obstacle: string | null;
  how: string | null;
  lesson: string | null;
  goal_tomorrow: string | null;
}

export interface Entry extends EntryFields {
  date: string; // YYYY-MM-DD
  created_at: string;
  updated_at: string;
}

export const TEXT_FIELDS = ['achievement', 'obstacle', 'how', 'lesson', 'goal_tomorrow'] as const;

export const FIELD_LABELS: Record<(typeof TEXT_FIELDS)[number] | 'categories' | 'date', string> = {
  date: 'Дата',
  achievement: 'Достижение дня',
  categories: 'Категории',
  obstacle: 'Преодолённое препятствие',
  how: 'Как я это сделал(а)',
  lesson: 'Что я узнал(а)',
  goal_tomorrow: 'Цель на завтра',
};

export const MAX_FIELD_LENGTH = 20000;
export const MIN_PASSWORD_LENGTH = 8;

export interface ExportFile {
  app: 'achievement-diary';
  version: 2;
  exported_at: string;
  entries: Entry[];
}

export interface ImportConflict {
  date: string;
  existing: Entry;
  incoming: Entry;
}

export interface ImportPreview {
  total: number;
  new: number;
  identical: number;
  conflicts: ImportConflict[];
}

export interface ImportResult {
  imported: number;
  replaced: number;
  kept: number;
  identical: number;
}

export type Resolution = 'keep' | 'replace';

/** Убирает повторы и неизвестные значения, приводит к порядку списка CATEGORIES. */
export function normalizeCategories(list: readonly unknown[]): Category[] {
  return CATEGORIES.filter((c) => list.includes(c));
}

export function isValidDate(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Нормализация для поиска без учёта регистра (SQLite LIKE не умеет кириллицу). */
export function normalizeText(s: string): string {
  return s.toLowerCase().replaceAll('ё', 'е');
}

const MONTHS_GEN = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];
const WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];

/** «16 ноября 2026, понедельник» */
export function formatDateLong(date: string, withWeekday = true): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const base = `${d} ${MONTHS_GEN[m - 1]} ${y}`;
  return withWeekday ? `${base}, ${WEEKDAYS[wd]}` : base;
}
