import { useEffect, useRef, useState } from 'preact/hooks';
import { CATEGORIES, type Entry } from '../../../shared/model';
import { listDates, listEntries } from '../data';
import { MONTHS, WEEKDAYS_SHORT, formatDateLong, monthGrid, todayLocal } from '../dates';
import { CategoryTags, Notice } from '../ui';

const PAGE = 20;

// Фильтры и вид переживают переход к записи и обратно.
const memo = { view: 'feed' as 'feed' | 'calendar', q: '', category: '', month: todayLocal().slice(0, 7) };

export function History() {
  const [view, setView] = useState(memo.view);
  memo.view = view;

  return (
    <div class="page">
      <header class="page-head page-head-row">
        <h1>История</h1>
        <div class="segmented" role="group" aria-label="Вид">
          <button type="button" class={view === 'feed' ? 'is-on' : ''} aria-pressed={view === 'feed'}
            onClick={() => setView('feed')}>Лента</button>
          <button type="button" class={view === 'calendar' ? 'is-on' : ''} aria-pressed={view === 'calendar'}
            onClick={() => setView('calendar')}>Календарь</button>
        </div>
      </header>
      {view === 'feed' ? <Feed /> : <Calendar />}
    </div>
  );
}

function Feed() {
  const [q, setQ] = useState(memo.q);
  const [category, setCategory] = useState(memo.category);
  const [items, setItems] = useState<Entry[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);
  memo.q = q;
  memo.category = category;

  const load = async (offset: number) => {
    const id = ++seq.current;
    setBusy(true);
    try {
      const res = await listEntries({ q, category, limit: PAGE, offset });
      if (id !== seq.current) return;
      setItems((prev) => (offset === 0 ? res.items : [...prev, ...res.items]));
      setTotal(res.total);
      setError('');
    } catch (e) {
      if (id === seq.current) setError((e as Error).message);
    } finally {
      if (id === seq.current) setBusy(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => void load(0), q ? 250 : 0);
    return () => clearTimeout(timer);
  }, [q, category]);

  const filtered = q.trim() !== '' || category !== '';

  return (
    <>
      <div class="filters">
        <input class="input" type="search" placeholder="Поиск по тексту" aria-label="Поиск по тексту"
          value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
        <select class="input" aria-label="Категория" value={category}
          onChange={(e) => setCategory((e.target as HTMLSelectElement).value)}>
          <option value="">Все категории</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {error && <Notice kind="error">{error}</Notice>}
      {total !== null && (
        <p class="muted count">{filtered ? `Найдено: ${total}` : `Записей всего: ${total}`}</p>
      )}

      {total === 0 && (
        <div class="empty">
          {filtered ? <p>Ничего не нашлось. Попробуйте другие слова.</p> : (
            <>
              <p>Здесь будут ваши записи.</p>
              <a class="btn" href="#/">Написать первую</a>
            </>
          )}
        </div>
      )}

      <ul class="feed">
        {items.map((e) => (
          <li key={e.date}>
            <a class="feed-item" href={`#/entry/${e.date}`}>
              <span class="feed-meta">
                <time dateTime={e.date}>{formatDateLong(e.date)}</time>
                <CategoryTags categories={e.categories} />
              </span>
              <span class="feed-text">{e.achievement}</span>
            </a>
          </li>
        ))}
      </ul>

      {total !== null && items.length < total && (
        <div class="actions actions-center">
          <button type="button" class="btn" disabled={busy} onClick={() => void load(items.length)}>
            Показать ещё
          </button>
        </div>
      )}
    </>
  );
}

function Calendar() {
  const today = todayLocal();
  const [month, setMonth] = useState(memo.month);
  const [dates, setDates] = useState<Set<string>>(new Set());
  memo.month = month;

  useEffect(() => {
    void listDates().then((d) => setDates(new Set(d))).catch(() => {});
  }, []);

  const [year, m] = month.split('-').map(Number) as [number, number];
  const shift = (delta: number) => {
    const d = new Date(Date.UTC(year, m - 1 + delta, 1));
    setMonth(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  };
  const isCurrent = month === today.slice(0, 7);

  return (
    <section class="sheet calendar" aria-label="Календарь">
      <div class="cal-head">
        <button type="button" class="btn btn-icon" aria-label="Предыдущий месяц" onClick={() => shift(-1)}>‹</button>
        <h2>{MONTHS[m - 1]} {year}</h2>
        <button type="button" class="btn btn-icon" aria-label="Следующий месяц" disabled={isCurrent}
          onClick={() => shift(1)}>›</button>
      </div>
      <div class="cal-grid cal-weekdays" aria-hidden="true">
        {WEEKDAYS_SHORT.map((w) => <span key={w}>{w}</span>)}
      </div>
      <div class="cal-grid">
        {monthGrid(year, m - 1).map((cell, i) => {
          if (!cell) return <span key={`e${i}`} />;
          const has = dates.has(cell.date);
          const cls = `cal-day${has ? ' has-entry' : ''}${cell.date === today ? ' is-today' : ''}`;
          if (cell.date > today) return <span key={cell.date} class={`${cls} is-future`}>{cell.day}</span>;
          return (
            <a key={cell.date} class={cls} href={has ? `#/entry/${cell.date}` : `#/day/${cell.date}`}
              aria-label={`${formatDateLong(cell.date, false)}${has ? ', есть запись' : ''}`}>
              {cell.day}
            </a>
          );
        })}
      </div>
      <p class="muted cal-legend"><span class="cal-dot" /> — день с записью. Нажмите на любой прошедший день, чтобы открыть или написать.</p>
    </section>
  );
}
