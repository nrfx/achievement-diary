import { useState } from 'preact/hooks';
import type { Entry } from '../../../shared/model';
import { randomEntry } from '../data';
import { formatDateLong } from '../dates';
import { CategoryTag, EntryBody, Notice } from '../ui';

export function Remember() {
  const [entry, setEntry] = useState<Entry | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const next = async () => {
    setBusy(true);
    setError('');
    try {
      setEntry(await randomEntry(entry?.date));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="page">
      <header class="page-head">
        <h1>Вспомни хорошее</h1>
        <p class="muted">Вы уже многое смогли. Вот одно из ваших достижений.</p>
      </header>

      {entry === undefined && (
        <div class="remember-start">
          <button type="button" class="btn btn-primary btn-big" disabled={busy} onClick={next}>
            Показать достижение
          </button>
        </div>
      )}

      {entry === null && (
        <div class="empty">
          <p>Записей пока нет — но первая может появиться уже сегодня.</p>
          <a class="btn" href="#/">Написать</a>
        </div>
      )}

      {entry && (
        <>
          <article class="sheet remember-card" key={entry.date}>
            <p class="remember-date">
              <time dateTime={entry.date}>{formatDateLong(entry.date)}</time>
              <CategoryTag category={entry.category} />
            </p>
            <EntryBody entry={entry} />
          </article>
          <div class="actions actions-center">
            <button type="button" class="btn btn-primary" disabled={busy} onClick={next}>Ещё одно</button>
            <a class="btn" href={`#/entry/${entry.date}`}>Открыть запись</a>
          </div>
        </>
      )}
      {error && <Notice kind="error">{error}</Notice>}
    </div>
  );
}
