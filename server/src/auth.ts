import crypto from 'node:crypto';
import argon2 from 'argon2';
import { MIN_PASSWORD_LENGTH } from '../../shared/model.js';
import type { Config } from './config.js';
import { type DB, getSetting, setSetting } from './db.js';

const PASSWORD_KEY = 'password_hash';

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

export async function setPassword(db: DB, password: string): Promise<void> {
  setSetting(db, PASSWORD_KEY, await hashPassword(password));
}

export async function verifyPassword(db: DB, password: string): Promise<boolean> {
  const hash = getSetting(db, PASSWORD_KEY);
  if (!hash) return false;
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

/**
 * Первый запуск: пароль берётся из DIARY_PASSWORD и сохраняется в БД как хеш.
 * Дальше переменная игнорируется (пароль меняется в настройках), если не задан
 * DIARY_PASSWORD_RESET=1.
 */
export async function ensurePassword(db: DB, config: Config): Promise<'created' | 'reset' | 'exists'> {
  const existing = getSetting(db, PASSWORD_KEY);
  if (existing && !config.passwordReset) return 'exists';
  if (!config.password) {
    throw new Error(
      existing
        ? 'DIARY_PASSWORD_RESET задан, но DIARY_PASSWORD пуст.'
        : 'Пароль ещё не задан. Укажите переменную окружения DIARY_PASSWORD для первого запуска.',
    );
  }
  if (config.password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`DIARY_PASSWORD слишком короткий: нужно минимум ${MIN_PASSWORD_LENGTH} символов.`);
  }
  await setPassword(db, config.password);
  if (existing) destroyAllSessions(db);
  return existing ? 'reset' : 'created';
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** В БД хранится только SHA-256 от токена: утечка файла БД не даёт готовых сессий. */
export function createSession(db: DB, days: number): { token: string; expires: Date } {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = new Date();
  const expires = new Date(now.getTime() + days * 86_400_000);
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now.toISOString());
  db.prepare('INSERT INTO sessions (token_hash, created_at, expires_at) VALUES (?, ?, ?)').run(
    hashToken(token),
    now.toISOString(),
    expires.toISOString(),
  );
  return { token, expires };
}

export function isSessionValid(db: DB, token: string | undefined): boolean {
  if (!token) return false;
  const row = db
    .prepare('SELECT expires_at FROM sessions WHERE token_hash = ?')
    .get(hashToken(token)) as { expires_at: string } | undefined;
  return !!row && row.expires_at > new Date().toISOString();
}

export function destroySession(db: DB, token: string | undefined): void {
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
}

export function destroyAllSessions(db: DB, exceptToken?: string): void {
  if (exceptToken) db.prepare('DELETE FROM sessions WHERE token_hash != ?').run(hashToken(exceptToken));
  else db.prepare('DELETE FROM sessions').run();
}
