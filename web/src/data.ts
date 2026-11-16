/**
 * Слой данных: запросы к API + запасной путь через локальную копию,
 * когда сервер недоступен (просмотр офлайн).
 */
import { useEffect, useState } from 'preact/hooks';
import {
  type Entry,
  type EntryFields,
  type ExportFile,
  type ImportPreview,
  type ImportResult,
  type Resolution,
  TEXT_FIELDS,
  normalizeText,
} from '../../shared/model';
import { clearAllDrafts } from './drafts';
import { localAll, localClear, localDelete, localGet, localPut, localReplaceAll } from './localdb';

export class ApiError extends Error {
  constructor(public status: number, message: string, public data?: unknown) {
    super(message);
  }
}
/** Сервер недоступен: нет сети или он не отвечает. */
export class OfflineError extends Error {
  constructor() {
    super('Нет связи с сервером.');
  }
}

// ---------- Состояние сети ----------

let offline = false;
const listeners = new Set<(v: boolean) => void>();
function setOffline(v: boolean) {
  if (offline === v) return;
  offline = v;
  for (const fn of listeners) fn(v);
}
export function useOffline(): boolean {
  const [v, set] = useState(offline);
  useEffect(() => {
    listeners.add(set);
    set(offline);
    return () => void listeners.delete(set);
  }, []);
  return v;
}

let onUnauthorized: () => void = () => {};
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    setOffline(true);
    throw new OfflineError();
  }
  if (res.status >= 502 && res.status <= 504) {
    setOffline(true);
    throw new OfflineError();
  }
  setOffline(false);
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && url !== '/api/login') onUnauthorized();
    const message = (data as { error?: string } | null)?.error ?? `Ошибка ${res.status}`;
    throw new ApiError(res.status, message, data);
  }
  return data as T;
}

async function withFallback<T>(online: () => Promise<T>, local: () => Promise<T>): Promise<T> {
  try {
    return await online();
  } catch (e) {
    if (e instanceof OfflineError) return local();
    throw e;
  }
}

// ---------- Сессия ----------

const AUTHED_KEY = 'diary:authed';
const flag = {
  get: () => { try { return localStorage.getItem(AUTHED_KEY) === '1'; } catch { return false; } },
  set: (v: boolean) => { try { v ? localStorage.setItem(AUTHED_KEY, '1') : localStorage.removeItem(AUTHED_KEY); } catch { /* ignore */ } },
};

/** 'offline' — сервер недоступен, но на устройстве есть копия после прошлого входа. */
export async function checkSession(): Promise<'in' | 'out' | 'offline'> {
  try {
    await request('GET', '/api/session');
    flag.set(true);
    return 'in';
  } catch (e) {
    if (e instanceof OfflineError && flag.get()) return 'offline';
    return 'out';
  }
}

export async function login(password: string): Promise<void> {
  await request('POST', '/api/login', { password });
  flag.set(true);
}

/** Выход стирает с устройства локальную копию записей и черновики. */
export async function logout(): Promise<void> {
  try {
    await request('POST', '/api/logout');
  } catch { /* выходим локально в любом случае */ }
  flag.set(false);
  clearAllDrafts();
  await localClear();
}

export const changePassword = (current: string, next: string) =>
  request<{ ok: true }>('POST', '/api/password', { current, next });

// ---------- Записи ----------

/** Обновляет локальную копию всех записей (фоново, после входа и импорта). */
export async function syncSnapshot(): Promise<void> {
  try {
    const file = await request<ExportFile>('GET', '/api/export?format=json');
    await localReplaceAll(file.entries);
  } catch { /* не критично */ }
}

export function getEntry(date: string): Promise<Entry | null> {
  return withFallback(
    async () => {
      try {
        const entry = await request<Entry>('GET', `/api/entries/${date}`);
        void localPut(entry);
        return entry;
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return null;
        throw e;
      }
    },
    () => localGet(date),
  );
}

export interface ListQuery {
  q: string;
  category: string;
  limit: number;
  offset: number;
}

function matches(e: Entry, words: string[], category: string): boolean {
  if (category && e.category !== category) return false;
  if (!words.length) return true;
  const hay = normalizeText([...TEXT_FIELDS.map((k) => e[k] ?? ''), e.category ?? ''].join('\n'));
  return words.every((w) => hay.includes(w));
}

export function listEntries(p: ListQuery): Promise<{ items: Entry[]; total: number }> {
  return withFallback(
    () => {
      const qs = new URLSearchParams({ limit: String(p.limit), offset: String(p.offset) });
      if (p.q.trim()) qs.set('q', p.q.trim());
      if (p.category) qs.set('category', p.category);
      return request('GET', `/api/entries?${qs}`);
    },
    async () => {
      const words = normalizeText(p.q).split(/\s+/).filter(Boolean);
      const all = (await localAll()).filter((e) => matches(e, words, p.category)).reverse();
      return { items: all.slice(p.offset, p.offset + p.limit), total: all.length };
    },
  );
}

export function listDates(): Promise<string[]> {
  return withFallback(
    async () => (await request<{ dates: { date: string }[] }>('GET', '/api/dates')).dates.map((d) => d.date),
    async () => (await localAll()).map((e) => e.date),
  );
}

export function getTotal(): Promise<number> {
  return withFallback(
    async () => (await request<{ total: number }>('GET', '/api/stats')).total,
    async () => (await localAll()).length,
  );
}

export function randomEntry(exclude?: string): Promise<Entry | null> {
  return withFallback(
    async () => {
      try {
        return await request<Entry>('GET', `/api/random${exclude ? `?exclude=${exclude}` : ''}`);
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return null;
        throw e;
      }
    },
    async () => {
      const all = await localAll();
      const pool = all.length > 1 ? all.filter((e) => e.date !== exclude) : all;
      return pool[Math.floor(Math.random() * pool.length)] ?? null;
    },
  );
}

export async function saveEntry(date: string, fields: EntryFields): Promise<Entry> {
  const entry = await request<Entry>('PUT', `/api/entries/${date}`, fields);
  void localPut(entry);
  return entry;
}

export async function removeEntry(date: string): Promise<void> {
  await request('DELETE', `/api/entries/${date}`);
  void localDelete(date);
}

// ---------- Импорт ----------

export const importPreview = (entries: unknown) =>
  request<ImportPreview>('POST', '/api/import?dryRun=1', { entries });

export async function importApply(entries: unknown, resolutions: Record<string, Resolution>): Promise<ImportResult> {
  const result = await request<ImportResult>('POST', '/api/import', { entries, resolutions });
  void syncSnapshot();
  return result;
}
