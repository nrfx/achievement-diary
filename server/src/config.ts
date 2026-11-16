import path from 'node:path';

export interface Config {
  host: string;
  port: number;
  dbPath: string;
  backupDir: string;
  backupKeep: number;
  /** Пароль из окружения: используется только при первом запуске или при сбросе. */
  password: string | undefined;
  passwordReset: boolean;
  /** Secure-cookie. Выключать только для локальной разработки по http. */
  cookieSecure: boolean;
  sessionDays: number;
  loginRateMax: number;
  loginRateWindowMs: number;
  /** Каталог со собранным фронтендом; undefined — только API. */
  staticDir: string | undefined;
  logger: boolean;
}

function bool(v: string | undefined, def: boolean): boolean {
  if (v === undefined || v === '') return def;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const dataDir = env.DATA_DIR ?? './data';
  return {
    host: env.HOST ?? '0.0.0.0',
    port: Number(env.PORT ?? 3000),
    dbPath: env.DB_PATH ?? path.join(dataDir, 'diary.sqlite'),
    backupDir: env.BACKUP_DIR ?? './backups',
    backupKeep: Number(env.BACKUP_KEEP ?? 14),
    password: env.DIARY_PASSWORD || undefined,
    passwordReset: bool(env.DIARY_PASSWORD_RESET, false),
    cookieSecure: bool(env.COOKIE_SECURE, true),
    sessionDays: Number(env.SESSION_DAYS ?? 30),
    loginRateMax: Number(env.LOGIN_RATE_MAX ?? 10),
    loginRateWindowMs: 15 * 60 * 1000,
    staticDir: env.STATIC_DIR ?? path.resolve('dist/web'),
    logger: bool(env.LOG, true),
  };
}
