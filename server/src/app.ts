import fs from 'node:fs';
import path from 'node:path';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { CATEGORIES, MIN_PASSWORD_LENGTH, type Resolution, isValidDate } from '../../shared/model.js';
import {
  createSession,
  destroyAllSessions,
  destroySession,
  isSessionValid,
  setPassword,
  verifyPassword,
} from './auth.js';
import type { Config } from './config.js';
import type { DB } from './db.js';
import {
  UnresolvedConflictsError,
  ValidationError,
  allEntries,
  applyImport,
  deleteEntry,
  getEntry,
  listDates,
  listEntries,
  parseFields,
  parseImportEntries,
  previewImport,
  randomEntry,
  stats,
  upsertEntry,
} from './entries.js';
import { toCsv, toJson, toMarkdown } from './exporters.js';

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const PUBLIC_API = new Set(['/api/login', '/api/health']);

export async function buildApp(db: DB, config: Config): Promise<FastifyInstance> {
  const app = Fastify({
    logger: config.logger ? { redact: ['req.headers.cookie', 'req.headers.authorization'] } : false,
    trustProxy: true, // приложение стоит за Caddy/nginx
    bodyLimit: 1024 * 1024,
  });

  // __Host- префикс: браузер примет cookie только с Secure, Path=/ и без Domain.
  const cookieName = config.cookieSecure ? '__Host-diary_session' : 'diary_session';
  const cookieOptions = {
    path: '/',
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'strict' as const,
  };
  const tokenOf = (req: FastifyRequest) => req.cookies[cookieName];

  await app.register(cookie);
  await app.register(rateLimit, { global: false });

  app.addHook('onRequest', async (req, reply) => {
    reply.headers({
      'Content-Security-Policy': CSP,
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
      'X-Robots-Tag': 'noindex, nofollow',
    });
    if (config.cookieSecure) reply.header('Strict-Transport-Security', 'max-age=31536000');

    const url = req.url.split('?')[0]!;
    if (!url.startsWith('/api/')) return;
    reply.header('Cache-Control', 'no-store');

    // Защита от CSRF в дополнение к SameSite=Strict: изменяющие запросы только со своего origin.
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers.origin) {
      let originHost: string | undefined;
      try {
        originHost = new URL(req.headers.origin).host;
      } catch { /* некорректный Origin */ }
      if (originHost !== req.host) return reply.code(403).send({ error: 'Запрос с чужого сайта отклонён.' });
    }
    if (!PUBLIC_API.has(url) && !isSessionValid(db, tokenOf(req))) {
      return reply.code(401).send({ error: 'Требуется вход.' });
    }
  });

  app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
    if (err instanceof ValidationError) return reply.code(400).send({ error: err.message });
    if (err instanceof UnresolvedConflictsError) {
      return reply.code(409).send({ error: err.message, conflicts: err.conflicts });
    }
    const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    if (status >= 500) app.log.error(err);
    const message =
      status === 429 ? 'Слишком много попыток. Подождите немного и попробуйте снова.'
      : status === 413 ? 'Слишком большой запрос.'
      : status >= 500 ? 'Внутренняя ошибка сервера.'
      : 'Некорректный запрос.';
    return reply.code(status).send({ error: message });
  });

  // ---------- Авторизация ----------

  app.get('/api/health', async () => ({ ok: true }));

  app.post(
    '/api/login',
    { config: { rateLimit: { max: config.loginRateMax, timeWindow: config.loginRateWindowMs } } },
    async (req, reply) => {
      const password = (req.body as { password?: unknown } | undefined)?.password;
      if (typeof password !== 'string' || password.length > 1024 || !(await verifyPassword(db, password))) {
        return reply.code(401).send({ error: 'Неверный пароль.' });
      }
      const { token, expires } = createSession(db, config.sessionDays);
      reply.setCookie(cookieName, token, { ...cookieOptions, expires });
      return { ok: true };
    },
  );

  app.post('/api/logout', async (req, reply) => {
    destroySession(db, tokenOf(req));
    reply.clearCookie(cookieName, cookieOptions);
    return { ok: true };
  });

  app.get('/api/session', async () => ({ authenticated: true }));

  app.post(
    '/api/password',
    { config: { rateLimit: { max: config.loginRateMax, timeWindow: config.loginRateWindowMs } } },
    async (req, reply) => {
      const { current, next } = (req.body ?? {}) as { current?: unknown; next?: unknown };
      if (typeof next !== 'string' || next.length < MIN_PASSWORD_LENGTH || next.length > 1024) {
        throw new ValidationError(`Новый пароль должен быть не короче ${MIN_PASSWORD_LENGTH} символов.`);
      }
      if (typeof current !== 'string' || !(await verifyPassword(db, current))) {
        return reply.code(403).send({ error: 'Текущий пароль указан неверно.' });
      }
      await setPassword(db, next);
      destroyAllSessions(db, tokenOf(req)); // остальные устройства разлогиниваются
      return { ok: true };
    },
  );

  // ---------- Записи ----------

  const dateParam = (req: FastifyRequest): string => {
    const { date } = req.params as { date: string };
    if (!isValidDate(date)) throw new ValidationError('Дата должна быть в формате ГГГГ-ММ-ДД.');
    return date;
  };

  app.get('/api/entries', async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const int = (v: string | undefined, def: number, min: number, max: number) => {
      const n = v === undefined ? def : Number.parseInt(v, 10);
      return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
    };
    for (const key of ['from', 'to'] as const) {
      if (q[key] && !isValidDate(q[key])) throw new ValidationError(`Параметр ${key}: ожидается ГГГГ-ММ-ДД.`);
    }
    if (q.category && !(CATEGORIES as readonly string[]).includes(q.category)) {
      throw new ValidationError('Неизвестная категория.');
    }
    const limit = int(q.limit, 20, 1, 100);
    const offset = int(q.offset, 0, 0, Number.MAX_SAFE_INTEGER);
    const { items, total } = listEntries(db, {
      q: q.q?.slice(0, 200), category: q.category, from: q.from, to: q.to, limit, offset,
    });
    return { items, total, limit, offset };
  });

  app.get('/api/dates', async () => ({ dates: listDates(db) }));
  app.get('/api/stats', async () => stats(db));

  app.get('/api/entries/:date', async (req, reply) => {
    const entry = getEntry(db, dateParam(req));
    return entry ?? reply.code(404).send({ error: 'Записи на эту дату нет.' });
  });

  app.put('/api/entries/:date', async (req, reply) => {
    const { entry, created } = upsertEntry(db, dateParam(req), parseFields(req.body));
    return reply.code(created ? 201 : 200).send(entry);
  });

  app.delete('/api/entries/:date', async (req, reply) => {
    return deleteEntry(db, dateParam(req))
      ? { ok: true }
      : reply.code(404).send({ error: 'Записи на эту дату нет.' });
  });

  app.get('/api/random', async (req, reply) => {
    const { exclude } = req.query as { exclude?: string };
    const entry = randomEntry(db, isValidDate(exclude) ? exclude : undefined);
    return entry ?? reply.code(404).send({ error: 'Пока нет ни одной записи.' });
  });

  // ---------- Экспорт / импорт ----------

  app.get('/api/export', async (req, reply) => {
    const format = (req.query as { format?: string }).format ?? 'json';
    const entries = allEntries(db);
    const stamp = new Date().toISOString().slice(0, 10);
    const send = (type: string, ext: string, body: string) =>
      reply
        .header('Content-Type', `${type}; charset=utf-8`)
        .header('Content-Disposition', `attachment; filename="diary-${stamp}.${ext}"`)
        .send(body);
    if (format === 'json') return send('application/json', 'json', toJson(entries));
    if (format === 'md') return send('text/markdown', 'md', toMarkdown(entries));
    if (format === 'csv') return send('text/csv', 'csv', toCsv(entries));
    throw new ValidationError('Формат должен быть json, md или csv.');
  });

  /**
   * Тело: { entries: [...], resolutions?: { "YYYY-MM-DD": "keep" | "replace" }, onConflict?: "keep" | "replace" }.
   * ?dryRun=1 — ничего не меняет, возвращает сводку и список конфликтов.
   * Без решения по конфликтной дате — 409 со списком конфликтов.
   */
  app.post('/api/import', { bodyLimit: 50 * 1024 * 1024 }, async (req) => {
    const body = (req.body ?? {}) as {
      entries?: unknown;
      resolutions?: Record<string, unknown>;
      onConflict?: unknown;
    };
    const incoming = parseImportEntries(body.entries);
    const dryRun = ['1', 'true'].includes((req.query as { dryRun?: string }).dryRun ?? '');
    if (dryRun) return previewImport(db, incoming);

    const isResolution = (v: unknown): v is Resolution => v === 'keep' || v === 'replace';
    const resolutions: Record<string, Resolution> = {};
    for (const [date, r] of Object.entries(body.resolutions ?? {})) {
      if (!isResolution(r)) throw new ValidationError(`Решение для ${date} должно быть keep или replace.`);
      resolutions[date] = r;
    }
    if (body.onConflict !== undefined && !isResolution(body.onConflict)) {
      throw new ValidationError('onConflict должен быть keep или replace.');
    }
    return applyImport(db, incoming, resolutions, body.onConflict);
  });

  // ---------- Фронтенд ----------

  const staticDir = config.staticDir;
  const hasStatic = !!staticDir && fs.existsSync(path.join(staticDir, 'index.html'));
  if (hasStatic) {
    await app.register(fastifyStatic, {
      root: staticDir,
      wildcard: false,
      setHeaders(res, filePath) {
        const immutable = filePath.includes(`${path.sep}assets${path.sep}`);
        res.header('Cache-Control', immutable ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    });
  }

  app.setNotFoundHandler((req: FastifyRequest, reply: FastifyReply) => {
    const url = req.url.split('?')[0]!;
    const isPage = req.method === 'GET' && !url.startsWith('/api/') && !path.extname(url);
    if (hasStatic && isPage) {
      return reply.header('Cache-Control', 'no-cache').sendFile('index.html');
    }
    return reply.code(404).send({ error: 'Не найдено.' });
  });

  return app;
}
