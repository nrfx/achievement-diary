import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { normalizeText } from '../../shared/model.js';

export type DB = Database.Database;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS entries (
  id            INTEGER PRIMARY KEY,
  date          TEXT NOT NULL UNIQUE
                CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  achievement   TEXT NOT NULL CHECK (length(trim(achievement)) > 0),
  categories    TEXT NOT NULL DEFAULT '[]',  -- JSON-массив названий
  obstacle      TEXT,
  how           TEXT,
  lesson        TEXT,
  goal_tomorrow TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
`;

export function openDb(dbPath: string): DB {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.exec(SCHEMA);
  migrate(db);
  // Поиск без учёта регистра для кириллицы.
  db.function('norm', { deterministic: true }, (s: unknown) =>
    s === null || s === undefined ? null : normalizeText(String(s)),
  );
  return db;
}

/** Версия 1 хранила одну категорию в колонке category; теперь — список в categories. */
function migrate(db: DB): void {
  const columns = (db.pragma('table_info(entries)') as { name: string }[]).map((c) => c.name);
  if (!columns.includes('category')) return;
  db.transaction(() => {
    if (!columns.includes('categories')) {
      db.exec("ALTER TABLE entries ADD COLUMN categories TEXT NOT NULL DEFAULT '[]'");
    }
    db.exec("UPDATE entries SET categories = json_array(category) WHERE category IS NOT NULL AND categories = '[]'");
    db.exec('ALTER TABLE entries DROP COLUMN category');
  })();
}

export function getSetting(db: DB, key: string): string | undefined {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value;
}

export function setSetting(db: DB, key: string, value: string): void {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, value);
}
