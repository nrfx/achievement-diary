export { formatDateLong, isValidDate } from '../../shared/model';

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Сегодняшняя дата по часам устройства, YYYY-MM-DD. */
export function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const MONTHS = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];
export const WEEKDAYS_SHORT = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];

export interface MonthCell {
  date: string;
  day: number;
}

/** Сетка месяца с понедельника; null — пустые ячейки до первого числа. */
export function monthGrid(year: number, month: number): (MonthCell | null)[] {
  const first = new Date(Date.UTC(year, month, 1));
  const lead = (first.getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells: (MonthCell | null)[] = Array(lead).fill(null);
  for (let d = 1; d <= days; d++) cells.push({ date: `${year}-${pad(month + 1)}-${pad(d)}`, day: d });
  return cells;
}
