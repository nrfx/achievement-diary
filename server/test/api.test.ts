import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Entry, ExportFile } from '../../shared/model.js';
import { buildApp } from '../src/app.js';
import { ensurePassword } from '../src/auth.js';
import { listBackups, runBackup } from '../src/backup.js';
import { type Config, loadConfig } from '../src/config.js';
import { type DB, openDb } from '../src/db.js';

const PASSWORD = 'correct horse battery';

function testConfig(over: Partial<Config> = {}): Config {
  return {
    ...loadConfig({}),
    dbPath: ':memory:',
    password: PASSWORD,
    staticDir: undefined,
    logger: false,
    loginRateMax: 100,
    ...over,
  };
}

async function start(over: Partial<Config> = {}) {
  const config = testConfig(over);
  const db = openDb(config.dbPath);
  await ensurePassword(db, config);
  const app = await buildApp(db, config);
  return { app, db };
}

async function login(app: FastifyInstance, password = PASSWORD) {
  const res = await app.inject({ method: 'POST', url: '/api/login', payload: { password } });
  const cookie = res.cookies[0];
  return { res, headers: cookie ? { cookie: `${cookie.name}=${cookie.value}` } : {} };
}

const full = {
  achievement: 'Закончила Отчёт, "сложный"; с запятыми,\nи переносом',
  categories: ['Карьера', 'Обучение'],
  obstacle: 'Усталость',
  how: 'Разбила на шаги',
  lesson: 'Маленькие шаги работают',
  goal_tomorrow: 'Прогулка',
};

describe('API', () => {
  let app: FastifyInstance;
  let db: DB;
  let headers: Record<string, string>;

  beforeEach(async () => {
    ({ app, db } = await start());
    ({ headers } = await login(app));
  });
  afterEach(async () => {
    await app.close();
    db.close();
  });

  const put = (date: string, payload: object) =>
    app.inject({ method: 'PUT', url: `/api/entries/${date}`, headers, payload });
  const get = (url: string) => app.inject({ method: 'GET', url, headers });

  it('закрывает API без сессии и пускает после входа', async () => {
    for (const url of ['/api/entries', '/api/entries/2026-01-01', '/api/random', '/api/export', '/api/session']) {
      expect((await app.inject({ method: 'GET', url })).statusCode).toBe(401);
    }
    expect((await app.inject({ method: 'POST', url: '/api/import', payload: { entries: [] } })).statusCode).toBe(401);
    expect((await login(app, 'wrong password')).res.statusCode).toBe(401);

    const { res } = await login(app);
    expect(res.statusCode).toBe(200);
    const c = res.cookies[0]!;
    expect(c).toMatchObject({ name: '__Host-diary_session', httpOnly: true, secure: true, sameSite: 'Strict', path: '/' });
    expect((await get('/api/session')).statusCode).toBe(200);

    await app.inject({ method: 'POST', url: '/api/logout', headers });
    expect((await get('/api/session')).statusCode).toBe(401);
  });

  it('хранит пароль только как хеш argon2', () => {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'password_hash'").get() as { value: string };
    expect(row.value.startsWith('$argon2id$')).toBe(true);
    expect(row.value).not.toContain(PASSWORD);
  });

  it('ограничивает частоту попыток входа', async () => {
    const limited = await start({ loginRateMax: 3 });
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await login(limited.app, 'nope')).res.statusCode);
    expect(codes).toEqual([401, 401, 401, 429, 429]);
    await limited.app.close();
  });

  it('отклоняет изменяющие запросы с чужого Origin', async () => {
    const res = await app.inject({
      method: 'PUT', url: '/api/entries/2026-03-01', payload: full,
      headers: { ...headers, origin: 'https://evil.example', host: 'diary.example' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('ставит заголовки безопасности', async () => {
    const h = (await get('/api/stats')).headers;
    expect(h['content-security-policy']).toContain("default-src 'self'");
    expect(h['x-content-type-options']).toBe('nosniff');
    expect(h['x-frame-options']).toBe('DENY');
    expect(h['cache-control']).toBe('no-store');
  });

  it('создаёт, читает, правит и удаляет запись', async () => {
    const created = await put('2026-03-01', { achievement: '  Пробежка 5 км  ' });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      date: '2026-03-01', achievement: 'Пробежка 5 км',
      categories: [], obstacle: null, how: null, lesson: null, goal_tomorrow: null,
    });

    const updated = await put('2026-03-01', full);
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject(full);
    expect(updated.json().created_at).toBe(created.json().created_at);

    expect((await get('/api/entries/2026-03-01')).json()).toMatchObject(full);
    expect((await get('/api/stats')).json().total).toBe(1); // одна запись в день

    expect((await app.inject({ method: 'DELETE', url: '/api/entries/2026-03-01', headers })).statusCode).toBe(200);
    expect((await get('/api/entries/2026-03-01')).statusCode).toBe(404);
  });

  it('проверяет входные данные', async () => {
    expect((await put('2026-03-01', { achievement: '   ' })).statusCode).toBe(400);
    expect((await put('2026-03-01', { obstacle: 'x' })).statusCode).toBe(400);
    expect((await put('2026-03-01', { achievement: 'x', categories: ['Прочее'] })).statusCode).toBe(400);
    expect((await put('2026-03-01', { achievement: 'x', categories: 'Карьера' })).statusCode).toBe(400);
    expect((await put('2026-02-30', { achievement: 'x' })).statusCode).toBe(400);
    expect((await put('1-2-3', { achievement: 'x' })).statusCode).toBe(400);
  });

  it('ищет без учёта регистра (кириллица), фильтрует и листает', async () => {
    await put('2026-01-01', { achievement: 'Первая ТРЕНИРОВКА', categories: ['Здоровье'] });
    await put('2026-01-02', { achievement: 'Сдал экзамен', categories: ['Обучение', 'Здоровье', 'Обучение'], lesson: 'Ёжик помог' });
    await put('2026-01-03', { achievement: 'Тренировка в зале', categories: ['Здоровье'] });

    const dates = async (url: string) => ((await get(url)).json().items as Entry[]).map((e) => e.date);
    expect(await dates('/api/entries')).toEqual(['2026-01-03', '2026-01-02', '2026-01-01']);
    expect(await dates(`/api/entries?q=${encodeURIComponent('тренировка')}`)).toEqual(['2026-01-03', '2026-01-01']);
    expect(await dates(`/api/entries?q=${encodeURIComponent('ежик')}`)).toEqual(['2026-01-02']);
    expect(await dates(`/api/entries?category=${encodeURIComponent('Обучение')}`)).toEqual(['2026-01-02']);
    // запись с несколькими категориями находится по каждой из них
    expect(await dates(`/api/entries?category=${encodeURIComponent('Здоровье')}`)).toEqual(['2026-01-03', '2026-01-02', '2026-01-01']);
    // повторы убираются, порядок — как в списке категорий
    expect((await get('/api/entries/2026-01-02')).json().categories).toEqual(['Здоровье', 'Обучение']);
    expect(await dates('/api/entries?from=2026-01-02&to=2026-01-02')).toEqual(['2026-01-02']);

    const page = (await get('/api/entries?limit=2&offset=2')).json();
    expect(page).toMatchObject({ total: 3, limit: 2, offset: 2 });
    expect(page.items).toHaveLength(1);
    expect((await get('/api/dates')).json().dates).toHaveLength(3);
  });

  it('отдаёт случайную запись', async () => {
    expect((await get('/api/random')).statusCode).toBe(404);
    await put('2026-01-01', { achievement: 'A' });
    await put('2026-01-02', { achievement: 'B' });
    for (let i = 0; i < 10; i++) {
      expect((await get('/api/random?exclude=2026-01-01')).json().date).toBe('2026-01-02');
    }
    await app.inject({ method: 'DELETE', url: '/api/entries/2026-01-02', headers });
    expect((await get('/api/random?exclude=2026-01-01')).json().date).toBe('2026-01-01');
  });

  it('экспорт → импорт в пустую базу без потерь', async () => {
    await put('2026-01-02', full);
    await put('2026-01-01', { achievement: 'Только достижение 🎉' });
    await put('2025-12-31', { achievement: 'Строка с\r\nпереносами', lesson: '<b>&"\'</b>' });
    const exported = (await get('/api/export?format=json')).json() as ExportFile;
    expect(exported.entries.map((e) => e.date)).toEqual(['2025-12-31', '2026-01-01', '2026-01-02']);

    const other = await start();
    const auth = (await login(other.app)).headers;
    const preview = await other.app.inject({
      method: 'POST', url: '/api/import?dryRun=1', headers: auth, payload: exported,
    });
    expect(preview.json()).toMatchObject({ total: 3, new: 3, identical: 0, conflicts: [] });
    expect((await other.app.inject({ method: 'GET', url: '/api/stats', headers: auth })).json().total).toBe(0);

    const result = await other.app.inject({ method: 'POST', url: '/api/import', headers: auth, payload: exported });
    expect(result.json()).toEqual({ imported: 3, replaced: 0, kept: 0, identical: 0 });

    const again = (await other.app.inject({ method: 'GET', url: '/api/export?format=json', headers: auth })).json() as ExportFile;
    expect(again.entries).toEqual(exported.entries); // включая created_at / updated_at

    // Повторный импорт того же файла ничего не меняет.
    const repeat = await other.app.inject({ method: 'POST', url: '/api/import', headers: auth, payload: exported });
    expect(repeat.json()).toEqual({ imported: 0, replaced: 0, kept: 0, identical: 3 });
    await other.app.close();
  });

  it('при конфликте дат импорт требует решения: оставить или заменить', async () => {
    await put('2026-01-01', { achievement: 'Моя версия' });
    await put('2026-01-02', { achievement: 'Тоже моя' });
    const entries = [
      { date: '2026-01-01', achievement: 'Версия из файла' },
      { date: '2026-01-02', achievement: 'И эта из файла' },
      { date: '2026-01-03', achievement: 'Новая' },
    ];
    const imp = (payload: object, q = '') => app.inject({ method: 'POST', url: `/api/import${q}`, headers, payload });

    const preview = (await imp({ entries }, '?dryRun=1')).json();
    expect(preview).toMatchObject({ new: 1, identical: 0 });
    expect(preview.conflicts.map((c: { date: string }) => c.date)).toEqual(['2026-01-01', '2026-01-02']);

    const unresolved = await imp({ entries, resolutions: { '2026-01-01': 'keep' } });
    expect(unresolved.statusCode).toBe(409);
    expect(unresolved.json().conflicts).toHaveLength(1);
    expect((await get('/api/stats')).json().total).toBe(2); // ничего не применилось

    const done = await imp({ entries, resolutions: { '2026-01-01': 'keep', '2026-01-02': 'replace' } });
    expect(done.json()).toEqual({ imported: 1, replaced: 1, kept: 1, identical: 0 });
    expect((await get('/api/entries/2026-01-01')).json().achievement).toBe('Моя версия');
    expect((await get('/api/entries/2026-01-02')).json().achievement).toBe('И эта из файла');
  });

  it('импортирует экспорт старого формата с одной категорией', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/import', headers,
      payload: { entries: [
        { date: '2026-01-01', achievement: 'Старая', category: 'Финансы' },
        { date: '2026-01-02', achievement: 'Без категории', category: null },
      ] },
    });
    expect(res.json()).toMatchObject({ imported: 2 });
    expect((await get('/api/entries/2026-01-01')).json().categories).toEqual(['Финансы']);
    expect((await get('/api/entries/2026-01-02')).json().categories).toEqual([]);
  });

  it('отклоняет повреждённый файл импорта целиком', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/import', headers,
      payload: { entries: [{ date: '2026-01-01', achievement: 'ok' }, { date: '2026-01-02' }] },
    });
    expect(res.statusCode).toBe(400);
    expect((await get('/api/stats')).json().total).toBe(0);
  });

  it('экспортирует Markdown (от старых к новым) и CSV', async () => {
    await put('2026-01-02', full);
    await put('2026-01-01', { achievement: 'Раньше' });

    const md = await get('/api/export?format=md');
    expect(md.headers['content-disposition']).toMatch(/attachment; filename="diary-.*\.md"/);
    expect(md.body).toContain('## 1 января 2026, четверг');
    expect(md.body).toContain('**Преодолённое препятствие**\n\nУсталость');
    expect(md.body.indexOf('1 января')).toBeLessThan(md.body.indexOf('2 января'));

    const csv = (await get('/api/export?format=csv')).body;
    const lines = csv.replace('﻿', '').split('\r\n');
    expect(lines[0]).toBe('date,achievement,categories,obstacle,how,lesson,goal_tomorrow,created_at,updated_at');
    expect(lines[1]!.startsWith('2026-01-01,Раньше,,,,,,')).toBe(true);
    expect(csv).toContain('"Закончила Отчёт, ""сложный""; с запятыми,\nи переносом"');
    expect(csv).toContain(',Карьера; Обучение,Усталость,');
    expect(md.body).toContain('**Категории:** Карьера, Обучение');
    expect((await get('/api/export?format=xml')).statusCode).toBe(400);
  });

  it('меняет пароль и завершает остальные сессии', async () => {
    const other = (await login(app)).headers;
    const change = (payload: object) => app.inject({ method: 'POST', url: '/api/password', headers, payload });
    expect((await change({ current: 'wrong', next: 'new password 123' })).statusCode).toBe(403);
    expect((await change({ current: PASSWORD, next: 'short' })).statusCode).toBe(400);
    expect((await change({ current: PASSWORD, next: 'new password 123' })).statusCode).toBe(200);

    expect((await get('/api/session')).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/session', headers: other })).statusCode).toBe(401);
    expect((await login(app, PASSWORD)).res.statusCode).toBe(401);
    expect((await login(app, 'new password 123')).res.statusCode).toBe(200);
  });
});

describe('Миграция', () => {
  it('переносит одну категорию из старой схемы в список', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'diary-mig-'));
    const file = path.join(dir, 'diary.sqlite');
    const old = new Database(file);
    old.exec(`CREATE TABLE entries (id INTEGER PRIMARY KEY, date TEXT NOT NULL UNIQUE, achievement TEXT NOT NULL,
      category TEXT, obstacle TEXT, how TEXT, lesson TEXT, goal_tomorrow TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      INSERT INTO entries (date, achievement, category, created_at, updated_at) VALUES
        ('2026-01-01', 'A', 'Карьера', 'x', 'x'), ('2026-01-02', 'B', NULL, 'x', 'x');`);
    old.close();
    for (let i = 0; i < 2; i++) { // повторное открытие ничего не ломает
      const db = openDb(file);
      expect(db.prepare('SELECT date, categories FROM entries ORDER BY date').all()).toEqual([
        { date: '2026-01-01', categories: '["Карьера"]' },
        { date: '2026-01-02', categories: '[]' },
      ]);
      db.close();
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('Бэкап', () => {
  it('делает читаемую копию БД и хранит только последние N', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'diary-test-'));
    const db = openDb(path.join(dir, 'diary.sqlite'));
    db.prepare(
      "INSERT INTO entries (date, achievement, created_at, updated_at) VALUES ('2026-01-01', 'Запись', 'x', 'x')",
    ).run();
    const backups = path.join(dir, 'backups');
    for (let day = 1; day <= 17; day++) {
      await runBackup(db, backups, 14, new Date(Date.UTC(2026, 0, day)));
    }
    const files = listBackups(backups);
    expect(files).toHaveLength(14);
    expect(files[0]).toBe('diary-2026-01-04.sqlite');
    expect(files.at(-1)).toBe('diary-2026-01-17.sqlite');

    const copy = new Database(path.join(backups, files.at(-1)!), { readonly: true });
    expect(copy.prepare('SELECT achievement FROM entries').all()).toEqual([{ achievement: 'Запись' }]);
    copy.close();
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
