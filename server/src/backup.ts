import fs from 'node:fs';
import path from 'node:path';
import type { DB } from './db.js';

const NAME_RE = /^diary-\d{4}-\d{2}-\d{2}\.sqlite$/;

function nameFor(now: Date): string {
  return `diary-${now.toISOString().slice(0, 10)}.sqlite`;
}

export function listBackups(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => NAME_RE.test(f)).sort();
}

/**
 * Согласованная копия БД через SQLite Online Backup API (безопасно при работающем
 * приложении), затем удаление старых копий сверх `keep`.
 */
export async function runBackup(db: DB, dir: string, keep: number, now = new Date()): Promise<string> {
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, nameFor(now));
  const tmp = `${target}.tmp`;
  fs.rmSync(tmp, { force: true });
  await db.backup(tmp);
  fs.renameSync(tmp, target);
  const all = listBackups(dir);
  for (const old of all.slice(0, Math.max(0, all.length - keep))) fs.rmSync(path.join(dir, old));
  return target;
}

/** Раз в час проверяет, есть ли копия за сегодня (UTC); если нет — делает. */
export function scheduleBackups(
  db: DB,
  dir: string,
  keep: number,
  log: (msg: string) => void,
): () => void {
  const tick = async () => {
    try {
      if (fs.existsSync(path.join(dir, nameFor(new Date())))) return;
      log(`Бэкап создан: ${await runBackup(db, dir, keep)}`);
    } catch (e) {
      log(`Ошибка бэкапа: ${(e as Error).message}`);
    }
  };
  void tick();
  const timer = setInterval(tick, 60 * 60 * 1000);
  timer.unref();
  return () => clearInterval(timer);
}
