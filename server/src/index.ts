import { buildApp } from './app.js';
import { ensurePassword } from './auth.js';
import { scheduleBackups } from './backup.js';
import { loadConfig } from './config.js';
import { openDb } from './db.js';

const config = loadConfig();
const db = openDb(config.dbPath);

try {
  const state = await ensurePassword(db, config);
  if (state === 'created') console.log('Пароль задан из DIARY_PASSWORD. Переменную теперь можно убрать из окружения.');
  if (state === 'reset') console.log('Пароль сброшен из DIARY_PASSWORD. Уберите DIARY_PASSWORD_RESET из окружения.');
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}

const app = await buildApp(db, config);
const stopBackups = scheduleBackups(db, config.backupDir, config.backupKeep, (m) => app.log.info(m));

const shutdown = async () => {
  stopBackups();
  await app.close();
  db.close();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

await app.listen({ host: config.host, port: config.port });
