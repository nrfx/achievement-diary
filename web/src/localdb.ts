/**
 * Локальная копия записей в IndexedDB — для просмотра без сети.
 * Все операции «мягкие»: если IndexedDB недоступна (приватный режим), приложение
 * просто работает без офлайн-копии.
 */
import type { Entry } from '../../shared/model';

const DB_NAME = 'diary-offline';
const STORE = 'entries';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'date' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await open();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(req ? req.result : undefined);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  } finally {
    db.close();
  }
}

async function soft<T>(p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p;
  } catch {
    return fallback;
  }
}

export const localPut = (entry: Entry) => soft(tx('readwrite', (s) => s.put(entry)).then(() => {}), undefined);
export const localDelete = (date: string) => soft(tx('readwrite', (s) => s.delete(date)).then(() => {}), undefined);
export const localGet = (date: string) =>
  soft(tx<Entry | undefined>('readonly', (s) => s.get(date)).then((e) => e ?? null), null);
/** Все записи, от старых к новым. */
export const localAll = () => soft(tx<Entry[]>('readonly', (s) => s.getAll()).then((a) => a ?? []), []);
export const localReplaceAll = (entries: Entry[]) =>
  soft(
    tx('readwrite', (s) => {
      s.clear();
      for (const e of entries) s.put(e);
    }).then(() => {}),
    undefined,
  );
export const localClear = () => soft(tx('readwrite', (s) => s.clear()).then(() => {}), undefined);
