import {
  CATEGORIES,
  type Category,
  type Entry,
  type EntryFields,
  type ImportConflict,
  type ImportPreview,
  type ImportResult,
  type Resolution,
  MAX_FIELD_LENGTH,
  TEXT_FIELDS,
  isValidDate,
  normalizeText,
} from '../../shared/model.js';
import type { DB } from './db.js';

const COLUMNS = 'date, achievement, category, obstacle, how, lesson, goal_tomorrow, created_at, updated_at';
const SEARCH_COLUMNS = ['achievement', 'obstacle', 'how', 'lesson', 'goal_tomorrow', 'category'];

export class ValidationError extends Error {}

function optionalText(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new ValidationError(`Поле ${field} должно быть строкой.`);
  const trimmed = value.trim();
  if (trimmed.length > MAX_FIELD_LENGTH) {
    throw new ValidationError(`Поле ${field} слишком длинное (максимум ${MAX_FIELD_LENGTH} символов).`);
  }
  return trimmed === '' ? null : trimmed;
}

export function parseFields(body: unknown): EntryFields {
  if (typeof body !== 'object' || body === null) throw new ValidationError('Ожидается JSON-объект.');
  const b = body as Record<string, unknown>;
  const achievement = optionalText(b.achievement, 'achievement');
  if (!achievement) throw new ValidationError('Достижение дня — обязательное поле.');
  const category = optionalText(b.category, 'category');
  if (category !== null && !(CATEGORIES as readonly string[]).includes(category)) {
    throw new ValidationError(`Неизвестная категория: ${category}.`);
  }
  return {
    achievement,
    category: category as Category | null,
    obstacle: optionalText(b.obstacle, 'obstacle'),
    how: optionalText(b.how, 'how'),
    lesson: optionalText(b.lesson, 'lesson'),
    goal_tomorrow: optionalText(b.goal_tomorrow, 'goal_tomorrow'),
  };
}

export function getEntry(db: DB, date: string): Entry | undefined {
  return db.prepare(`SELECT ${COLUMNS} FROM entries WHERE date = ?`).get(date) as Entry | undefined;
}

export interface Timestamps {
  created_at?: string;
  updated_at?: string;
}

/** Создаёт или целиком заменяет запись на дату. */
export function upsertEntry(
  db: DB,
  date: string,
  f: EntryFields,
  ts: Timestamps = {},
): { entry: Entry; created: boolean } {
  const now = new Date().toISOString();
  const existing = getEntry(db, date);
  if (existing) {
    db.prepare(
      `UPDATE entries SET achievement = ?, category = ?, obstacle = ?, how = ?, lesson = ?,
         goal_tomorrow = ?, created_at = ?, updated_at = ? WHERE date = ?`,
    ).run(
      f.achievement, f.category, f.obstacle, f.how, f.lesson, f.goal_tomorrow,
      ts.created_at ?? existing.created_at, ts.updated_at ?? now, date,
    );
  } else {
    db.prepare(
      `INSERT INTO entries (date, achievement, category, obstacle, how, lesson, goal_tomorrow, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      date, f.achievement, f.category, f.obstacle, f.how, f.lesson, f.goal_tomorrow,
      ts.created_at ?? now, ts.updated_at ?? now,
    );
  }
  return { entry: getEntry(db, date)!, created: !existing };
}

export function deleteEntry(db: DB, date: string): boolean {
  return db.prepare('DELETE FROM entries WHERE date = ?').run(date).changes > 0;
}

export interface ListParams {
  q?: string;
  category?: string;
  from?: string;
  to?: string;
  limit: number;
  offset: number;
}

export function listEntries(db: DB, p: ListParams): { items: Entry[]; total: number } {
  const where: string[] = [];
  const args: unknown[] = [];
  // Каждое слово запроса должно встретиться хотя бы в одном из полей.
  for (const word of normalizeText(p.q ?? '').split(/\s+/).filter(Boolean)) {
    where.push('(' + SEARCH_COLUMNS.map((c) => `instr(norm(${c}), ?) > 0`).join(' OR ') + ')');
    for (let i = 0; i < SEARCH_COLUMNS.length; i++) args.push(word);
  }
  if (p.category) { where.push('category = ?'); args.push(p.category); }
  if (p.from) { where.push('date >= ?'); args.push(p.from); }
  if (p.to) { where.push('date <= ?'); args.push(p.to); }
  const cond = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = (db.prepare(`SELECT count(*) AS n FROM entries ${cond}`).get(...args) as { n: number }).n;
  const items = db
    .prepare(`SELECT ${COLUMNS} FROM entries ${cond} ORDER BY date DESC LIMIT ? OFFSET ?`)
    .all(...args, p.limit, p.offset) as Entry[];
  return { items, total };
}

export function allEntries(db: DB): Entry[] {
  return db.prepare(`SELECT ${COLUMNS} FROM entries ORDER BY date ASC`).all() as Entry[];
}

export function listDates(db: DB): { date: string; category: string | null }[] {
  return db.prepare('SELECT date, category FROM entries ORDER BY date ASC').all() as {
    date: string;
    category: string | null;
  }[];
}

export function randomEntry(db: DB, exclude?: string): Entry | undefined {
  const pick = (cond: string, ...args: unknown[]) =>
    db.prepare(`SELECT ${COLUMNS} FROM entries ${cond} ORDER BY random() LIMIT 1`).get(...args) as
      | Entry
      | undefined;
  return (exclude ? pick('WHERE date != ?', exclude) : undefined) ?? pick('');
}

export function stats(db: DB): { total: number; first_date: string | null } {
  return db.prepare('SELECT count(*) AS total, min(date) AS first_date FROM entries').get() as {
    total: number;
    first_date: string | null;
  };
}

// ---------- Импорт ----------

function isIsoTimestamp(v: unknown): v is string {
  return typeof v === 'string' && v.length <= 40 && !Number.isNaN(Date.parse(v));
}

/** Проверяет записи из файла импорта. Любая ошибка отклоняет весь файл. */
export function parseImportEntries(raw: unknown): Entry[] {
  if (!Array.isArray(raw)) throw new ValidationError('В файле нет массива entries.');
  const seen = new Set<string>();
  const now = new Date().toISOString();
  return raw.map((item, i) => {
    const r = (item ?? {}) as Record<string, unknown>;
    const where = `Запись №${i + 1}${typeof r.date === 'string' ? ` (${r.date})` : ''}`;
    if (!isValidDate(r.date)) throw new ValidationError(`${where}: некорректная дата.`);
    if (seen.has(r.date)) throw new ValidationError(`${where}: дата встречается в файле дважды.`);
    seen.add(r.date);
    let fields: EntryFields;
    try {
      fields = parseFields(r);
    } catch (e) {
      throw new ValidationError(`${where}: ${(e as Error).message}`);
    }
    const created_at = isIsoTimestamp(r.created_at) ? r.created_at : now;
    const updated_at = isIsoTimestamp(r.updated_at) ? r.updated_at : created_at;
    return { date: r.date, ...fields, created_at, updated_at };
  });
}

function sameContent(a: EntryFields, b: EntryFields): boolean {
  return a.category === b.category && TEXT_FIELDS.every((k) => (a[k] ?? null) === (b[k] ?? null));
}

export function previewImport(db: DB, incoming: Entry[]): ImportPreview {
  const preview: ImportPreview = { total: incoming.length, new: 0, identical: 0, conflicts: [] };
  for (const inc of incoming) {
    const existing = getEntry(db, inc.date);
    if (!existing) preview.new++;
    else if (sameContent(existing, inc)) preview.identical++;
    else preview.conflicts.push({ date: inc.date, existing, incoming: inc });
  }
  return preview;
}

export class UnresolvedConflictsError extends Error {
  constructor(public conflicts: ImportConflict[]) {
    super('Есть конфликты по датам: выберите, какую версию оставить.');
  }
}

/** Слияние по дате. Для каждой конфликтной даты нужно явное решение. */
export function applyImport(
  db: DB,
  incoming: Entry[],
  resolutions: Record<string, Resolution>,
  onConflict?: Resolution,
): ImportResult {
  const unresolved = previewImport(db, incoming).conflicts.filter(
    (c) => !(resolutions[c.date] ?? onConflict),
  );
  if (unresolved.length) throw new UnresolvedConflictsError(unresolved);

  const result: ImportResult = { imported: 0, replaced: 0, kept: 0, identical: 0 };
  db.transaction(() => {
    for (const inc of incoming) {
      const existing = getEntry(db, inc.date);
      const ts = { created_at: inc.created_at, updated_at: inc.updated_at };
      if (!existing) {
        upsertEntry(db, inc.date, inc, ts);
        result.imported++;
      } else if (sameContent(existing, inc)) {
        result.identical++;
      } else if ((resolutions[inc.date] ?? onConflict) === 'replace') {
        upsertEntry(db, inc.date, inc, ts);
        result.replaced++;
      } else {
        result.kept++;
      }
    }
  })();
  return result;
}
