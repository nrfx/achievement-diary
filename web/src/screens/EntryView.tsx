import { useEffect, useState } from 'preact/hooks';
import type { Entry } from '../../../shared/model';
import { getEntry } from '../data';
import { formatDateLong } from '../dates';
import { CategoryTag, EntryBody } from '../ui';

export function EntryView({ date }: { date: string }) {
  const [entry, setEntry] = useState<Entry | null | undefined>(undefined);

  useEffect(() => {
    void getEntry(date).catch(() => null).then(setEntry);
  }, [date]);

  return (
    <div class="page">
      <p class="back"><a href="#/history">← История</a></p>
      <header class="page-head">
        <h1>{formatDateLong(date, false)}</h1>
        <p class="muted">{formatDateLong(date).split(', ')[1]}</p>
      </header>
      {entry === null && (
        <div class="empty">
          <p>На этот день записи нет.</p>
          <a class="btn" href={`#/day/${date}`}>Написать</a>
        </div>
      )}
      {entry && (
        <>
          <article class="sheet">
            <CategoryTag category={entry.category} />
            <EntryBody entry={entry} />
          </article>
          <div class="actions">
            <a class="btn" href={`#/day/${date}`}>Редактировать</a>
          </div>
        </>
      )}
    </div>
  );
}
